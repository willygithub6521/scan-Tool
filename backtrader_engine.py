import backtrader as bt
import pandas as pd
import numpy as np

class FixedCommInfo(bt.CommInfoBase):
    """自訂固定手續費類別 (每趟交易收取固定 $X USD)"""
    params = (
        ('commission', 5.0),
        ('margin', None),
        ('mult', 1.0),
    )
    def _getcommission(self, size, price, pseudoexec):
        return self.p.commission

class LoggingStrategy(bt.Strategy):
    def prenext(self):
        # 💡 神級解法：破解 Backtrader 預設的「齊頭式時間等待」限制 (收盤結算專用)
        # 呼叫這行就可以讓歷史悠久的標的無痛「提早獨立起跑」！
        self.next_open()
        self.next()

    # def _next_open(self):
    #     # 💡 第二道神級解法：破解 Backtrader 在 cheat_on_open 時的刁難 (開盤進場專用)
    #     # 內建底層會檢查 isvalid()，若有未上市股票就會把整個開盤函數卡死。
    #     # 覆寫這個強制呼叫，讓 MomentumShortStrategy 的開盤跳空防線能順利作動！
    #     self.next_open()

    def __init__(self):
        self.trade_logs = []
        self._open_trade_sizes = {}
        self.intraday_exit_data = {}
        
    def notify_trade(self, trade):
        if trade.justopened:
            self._open_trade_sizes[trade.ref] = trade.size
            self.intraday_exit_data[trade.data] = {}
            
        elif trade.isclosed:
            opened_size = self._open_trade_sizes.pop(trade.ref, trade.size)
            if opened_size == 0:
                opened_size = 1  # Fallback to prevent crash, though logic should be sound
                
            actual_exit = trade.price + (trade.pnl / opened_size)
            
            theo_exit = self.intraday_exit_data.pop(trade.data, {})
            if theo_exit.get('price'):
                exit_price = theo_exit['price']
                status_remark = theo_exit['status']
                
                # 計算理論獲利與實際獲利的差異並手動補償券商現金池
                diff_cash = (actual_exit - exit_price) * abs(opened_size)
                self.broker.add_cash(diff_cash)
                
                final_pnl = trade.pnlcomm + diff_cash
            else:
                exit_price = actual_exit
                status_remark = '收盤強制回補'
                final_pnl = trade.pnlcomm
            
            # 放空毛利率計算： (進場價 - 出場價) / 進場價
            margin_pct = 0.0
            if trade.price > 0:
                if not trade.long: # 放空
                    margin_pct = (trade.price - exit_price) / trade.price * 100
                else: # 做多
                    margin_pct = (exit_price - trade.price) / trade.price * 100

            self.trade_logs.append({
                '標的': trade.data._name,
                '進場日期': bt.num2date(trade.dtopen).strftime('%Y-%m-%d'),
                '出場日期': bt.num2date(trade.dtclose).strftime('%Y-%m-%d'),
                '方向': '作多' if trade.long else '放空',
                '進場股數': abs(opened_size),
                '進場價': round(trade.price, 2),
                '出場價': round(exit_price, 2),
                '持倉天數': trade.barlen,
                '出場備註': status_remark,
                '淨獲利(USD)': round(final_pnl, 2),
                '毛利率(%)': round(margin_pct, 2)
            })

class MomentumShortStrategy(LoggingStrategy):
    """暴漲放空策略：具備時間停損與動態 SL/TP (支援多標的)"""
    params = (
        ('cond1_pct', 90.0),
        ('cond2_pct', 70.0),
        ('stake_mode', 'shares'),
        ('stake_val', 100.0),
        ('tp_pct', 0.0),
        ('sl_pct', 0.0),
        ('max_hold', 1),
    )

    def __init__(self):
        super().__init__()
        self.hold_days = {data: 0 for data in self.datas}

    def next_open(self):
        for data in self.datas:
            pos = self.getposition(data)
            if not pos:
                # 在 T+1 日開盤檢查：需要 T+1(open), T 日, T-1 日 故至少要 3 根 K 線
                if len(data) >= 3:
                    prev_close = data.close[-1]
                    prev_prev_close = data.close[-2]
                    prev_open = data.open[-1]
                    curr_open = data.open[0]
                    
                    if prev_close > 0 and prev_prev_close > 0 and prev_open > 0:
                        ret_t = (prev_close / prev_prev_close - 1.0) * 100.0
                        body_t = (prev_close / prev_open - 1.0) * 100.0
                        
                        if ret_t >= self.params.cond1_pct and body_t >= self.params.cond2_pct:
                            # 關鍵防護：如果放空那日開盤比前一日收盤(暴漲日)還高，就不交易！
                            if curr_open <= prev_close and curr_open >= 1.0:
                                price = curr_open if curr_open > 0 else 1.0
                                if self.params.stake_mode == 'cash':
                                    size = int(self.params.stake_val // price)
                                    if size == 0: size = 1 # 防呆
                                else:
                                    size = int(self.params.stake_val)
                                    
                                max_size = int(self.broker.getvalue() // price)
                                if size > max_size:
                                    size = max_size
                                    
                                if size > 0:
                                    self.sell(data=data, size=size)
                                    self.hold_days[data] = 0

    def next(self):
        for data in self.datas:
            pos = self.getposition(data)
            if pos:
                self.hold_days[data] += 1
                
                # ==== 盤中攔截：暴力掛載修正 ====
                # 當我們有持倉，檢查盤中極端價格是否碰到停損停利！
                if data in self.intraday_exit_data and not self.intraday_exit_data[data].get('price'):
                    open_p, high_p, low_p = data.open[0], data.high[0], data.low[0]
                    # 進場價以「當日開盤價」作為基準計算 TP/SL
                    tp_p = open_p * (1 - self.params.tp_pct / 100.0) if self.params.tp_pct > 0 else -1
                    sl_p = open_p * (1 + self.params.sl_pct / 100.0) if self.params.sl_pct > 0 else 999999
                    
                    hit_tp = low_p <= tp_p and tp_p > 0
                    hit_sl = high_p >= sl_p and sl_p < 999999
                    
                    if hit_tp and hit_sl:
                        self.intraday_exit_data[data] = {'price': sl_p, 'status': '日內觸及止損 (雙觸悲觀認定)'}
                        self.close(data=data)
                        continue
                    elif hit_tp:
                        self.intraday_exit_data[data] = {'price': tp_p, 'status': '日內觸及止盈'}
                        self.close(data=data)
                        continue
                    elif hit_sl:
                        self.intraday_exit_data[data] = {'price': sl_p, 'status': '日內觸及止損'}
                        self.close(data=data)
                        continue

                # 收盤結算獲利：(賣出價 - 現在收盤價) / 賣出價
                current_pct = (pos.price - data.close[0]) / pos.price * 100.0 if pos.price > 0 else 0.0
                
                # 時間停損 (最大持有天數)
                if self.hold_days[data] >= self.params.max_hold:
                    self.close(data=data)
                    continue

class DualSMAStrategy(LoggingStrategy):
    """雙均線做多策略，支援動態止盈止損 (支援多標的)"""
    params = (
        ('fast', 20),
        ('slow', 60),
        ('stake_mode', 'shares'),
        ('stake_val', 100.0),
        ('tp_pct', 15.0),  # Take profit
        ('sl_pct', 5.0),   # Stop loss
    )

    def __init__(self):
        super().__init__()
        self.crossovers = {}
        for data in self.datas:
            fast_sma = bt.indicators.SimpleMovingAverage(data.close, period=self.params.fast)
            slow_sma = bt.indicators.SimpleMovingAverage(data.close, period=self.params.slow)
            self.crossovers[data] = bt.indicators.CrossOver(fast_sma, slow_sma)

    def next(self):
        for data in self.datas:
            # 💡 因為透過 prenext() 提早解除封印了，必須手動檢查每檔股票的 K 線長度
            # 是否已經超過均線所需的「最慢天數」，否則指標還沒算出來會噴錯！
            if len(data) <= self.params.slow:
                continue
                
            pos = self.getposition(data)
            # 安全讀取跨界訊號 (指標保證已暖機完成)
            cross = self.crossovers[data][0]
            
            if not pos:
                if cross > 0:
                    price = data.close[0] if data.close[0] > 0 else 1.0
                    if self.params.stake_mode == 'cash':
                        size = int(self.params.stake_val // price)
                    else:
                        size = int(self.params.stake_val)
                        
                    # Prevent going beyond current available cash for long strategy
                    max_size = int(self.broker.getcash() // price)
                    if size > max_size:
                        size = max_size
                        
                    if size > 0:
                        self.buy(data=data, size=size)
            else:
                # 死亡交叉優先平倉
                if cross < 0:
                    self.close(data=data)
                    continue

                # 如果沒有死亡交叉，檢查止損止盈
                current_pct = (data.close[0] - pos.price) / pos.price * 100.0 if pos.price > 0 else 0.0
                
                # 停利出場 (Take Profit)
                if self.params.tp_pct > 0 and current_pct >= self.params.tp_pct:
                    self.close(data=data)
                    continue
                    
                # 停損出場 (Stop Loss)
                if self.params.sl_pct > 0 and current_pct <= -self.params.sl_pct:
                    self.close(data=data)
                    continue

def run_backtrader(dfs: dict, params_dict: dict):
    # cheat_on_open enables easier intraday logic if needed later
    cerebro = bt.Cerebro(cheat_on_open=True)
    
    for name, df in dfs.items():
        if df.empty:
            continue
        df_copy = df.copy()
        
        if not isinstance(df_copy.index, pd.DatetimeIndex):
            try:
                # If index is not datetime, try converting
                for date_col in ['Date', 'date', 'Timestamp', 'timestamp']:
                    if date_col in df_copy.columns:
                        df_copy[date_col] = pd.to_datetime(df_copy[date_col])
                        df_copy.set_index(date_col, inplace=True)
                        break
            except Exception:
                pass
                
        mapping = {c: c.lower() for c in df_copy.columns}
        df_copy = df_copy.rename(columns=mapping)
        valid = True
        for col in ['open', 'high', 'low', 'close', 'volume']:
            if col not in df_copy.columns:
                valid = False
                break
        
        if valid:
            # openinterest=-1 means it is not used
            datafeed = bt.feeds.PandasData(dataname=df_copy, name=name, openinterest=-1)
            cerebro.adddata(datafeed)
    
    if not cerebro.datas:
        raise ValueError("沒有有效的歷史數據供大腦引擎使用！")

    # 掛載策略
    if params_dict.get('strategy') == 'momentum_short':
        cerebro.addstrategy(
            MomentumShortStrategy, 
            cond1_pct=float(params_dict.get('cond1_pct', 90.0)),
            cond2_pct=float(params_dict.get('cond2_pct', 70.0)),
            stake_mode=params_dict.get('stake_mode', 'shares'),
            stake_val=float(params_dict.get('stake_val', 100.0)),
            tp_pct=float(params_dict.get('tp_pct', 0.0)),
            sl_pct=float(params_dict.get('sl_pct', 0.0)),
            max_hold=int(params_dict.get('max_hold', 1))
        )
    else:
        cerebro.addstrategy(
            DualSMAStrategy, 
            fast=int(params_dict.get('sma_fast', 20)), 
            slow=int(params_dict.get('sma_slow', 60)),
            stake_mode=params_dict.get('stake_mode', 'shares'),
            stake_val=float(params_dict.get('stake_val', 100.0)),
            tp_pct=float(params_dict.get('tp_pct', 0.0)),
            sl_pct=float(params_dict.get('sl_pct', 0.0))
        )
    
    # 掛載初始資金與手續費
    cerebro.broker.setcash(params_dict.get('starting_cash', 100000))
    
    if params_dict.get('is_fixed_comm', False):
        # 固定手續費模式
        comminfo = FixedCommInfo(commission=params_dict.get('commission_val', 5.0))
        cerebro.broker.addcommissioninfo(comminfo)
    else:
        # 百分比手續費模式
        cerebro.broker.setcommission(commission=params_dict.get('commission_val', 0.001))
    
    cerebro.addanalyzer(bt.analyzers.TimeReturn, _name='time_return')
    cerebro.addanalyzer(bt.analyzers.DrawDown, _name='drawdown')
    cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name='trades')
    cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name='sharpe', timeframe=bt.TimeFrame.Days, compression=1, factor=252, riskfreerate=0.0)
    
    results = cerebro.run()
    strategy_instance = results[0]
    
    final_value = cerebro.broker.getvalue()
    analyzers = strategy_instance.analyzers
    
    time_return = analyzers.time_return.get_analysis()
    drawdown_info = analyzers.drawdown.get_analysis()
    # trades_info = analyzers.trades.get_analysis()
    sharpe_info = analyzers.sharpe.get_analysis()
    
    equity_df = pd.DataFrame(list(time_return.items()), columns=['Date', 'Daily_Return'])
    equity_df.set_index('Date', inplace=True)
    equity_df['Cumulative_Return'] = (1 + equity_df['Daily_Return']).cumprod() - 1
    
    # total_trades = trades_info.total.closed if hasattr(trades_info, 'total') and 'closed' in trades_info.total else 0
    # if total_trades > 0 and hasattr(trades_info, 'won'):
    #     win_rate = (trades_info.won.total / total_trades) * 100
    # else:
    #     win_rate = 0.0
    
    sharpe = sharpe_info.get('sharperatio', 0.0)
    sharpe = sharpe if sharpe is not None else 0.0
    
    trade_logs_df = pd.DataFrame(strategy_instance.trade_logs)
    
    if not trade_logs_df.empty:
        trade_logs_df = trade_logs_df.sort_values(by="出場日期").reset_index(drop=True)
        cols = ['標的', '進場日期', '出場日期', '方向', '進場股數', '進場價', '出場價', '持倉天數', '出場備註', '淨獲利(USD)', '毛利率(%)']
        trade_logs_df = trade_logs_df[cols]
        
        total_trades = len(trade_logs_df)
        won_trades = len(trade_logs_df[trade_logs_df['淨獲利(USD)'] > 0])
        win_rate = (won_trades / total_trades) * 100 if total_trades > 0 else 0.0
    else:
        total_trades = 0
        win_rate = 0.0
        
    metrics = {
        "final_value": final_value,
        "total_return_pct": (final_value / params_dict.get('starting_cash', 100000) - 1) * 100,
        "mdd_pct": drawdown_info.max.drawdown if 'max' in drawdown_info else 0.0,
        "total_trades": total_trades,
        "win_rate": win_rate,
        "sharpe": sharpe
    }
    
    # trade_logs_df = pd.DataFrame(strategy_instance.trade_logs)
    # if not trade_logs_df.empty:
    #     trade_logs_df = trade_logs_df.sort_values(by="出場日期").reset_index(drop=True)
    #     # reorder columns to put Trade Size in a prominent position
    #     cols = ['標的', '進場日期', '出場日期', '方向', '進場股數', '進場價', '出場價', '持倉天數', '出場備註', '淨獲利(USD)', '毛利率(%)']
    #     trade_logs_df = trade_logs_df[cols]
    
    return metrics, equity_df, trade_logs_df


# =====================================================================
# 5min 線精確回測引擎 (C 策略 — 獨立模組，不影響上方的日線策略)
# =====================================================================

class Logging5minStrategy(bt.Strategy):
    """分鐘線通用日誌父類別：使用原生訂單，不需 add_cash 補償"""
    def prenext(self):
        # 💡 破解 Backtrader 預設的「齊頭式時間等待」限制 (收盤結算專用)
        # 呼叫這行就可以讓歷史悠久的標的無痛「提早獨立起跑」！
        self.next()

    def __init__(self):
        self.trade_logs = []
        self._open_sizes = {}

    def notify_trade(self, trade):
        if trade.justopened:
            self._open_sizes[trade.ref] = trade.size
        elif trade.isclosed:
            opened_size = self._open_sizes.pop(trade.ref, 1) # 防呆預設 1
            exit_price = trade.price + (trade.pnl / opened_size)
            margin_pct = 0.0
            if trade.price > 0:
                if not trade.long:
                    margin_pct = (trade.price - exit_price) / trade.price * 100
                else:
                    margin_pct = (exit_price - trade.price) / trade.price * 100
            self.trade_logs.append({
                '標的': trade.data._name,
                '進場時間': bt.num2date(trade.dtopen).strftime('%Y-%m-%d %H:%M'),
                '出場時間': bt.num2date(trade.dtclose).strftime('%Y-%m-%d %H:%M'),
                '方向': '作多' if trade.long else '放空',
                '進場股數': abs(opened_size),
                '進場價': round(trade.price, 4),
                '出場價': round(exit_price, 4),
                '持倉根數': trade.barlen,
                '淨獲利(USD)': round(trade.pnlcomm, 2),
                '毛利率(%)': round(margin_pct, 2)
            })


class MomentumShort5minStrategy(Logging5minStrategy):
    """
    5分鐘線精確放空策略：
    - 每個交易日 09:30 第一根 K 棒以市價做空進場
    - 同時掛出 Limit 止盈單與 Stop 止損單 (OCO 對)
    - 若當天 ≥15:55 前沒有觸發，收盤強制市價平倉
    """
    params = (
        ('stake_mode', 'shares'),
        ('stake_val', 100.0),
        ('tp_pct', 15.0),
        ('sl_pct', 5.0),
    )

    def __init__(self):
        super().__init__()
        self._entered_today = {}
        self._pending_tp = {}
        self._pending_sl = {}

    def _cancel_exit_orders(self, data):
        for order_dict in [self._pending_tp, self._pending_sl]:
            o = order_dict.pop(data, None)
            if o and o.status in [o.Created, o.Submitted, o.Accepted, o.Partial]:
                self.cancel(o)

    def next(self):
        import datetime
        for data in self.datas:
            if len(data) == 0:
                continue
                
            pos = self.getposition(data)
            bar_time = data.datetime.time(0)
            bar_date = data.datetime.date(0)

            if not pos:
                # 只要時間 >= 09:30 且今日還沒進場過，就執行一次 (可覆蓋到第一根 K 是 9:35 的股票)
                if bar_time >= datetime.time(9, 30):
                    if self._entered_today.get(data) != bar_date:
                        price = data.close[0]
                        if price <= 0:
                            continue

                        if self.params.stake_mode == 'cash':
                            size = int(self.params.stake_val // price)
                        else:
                            size = int(self.params.stake_val)

                        max_size = int(self.broker.getvalue() // price)
                        size = min(size, max_size)
                        if size <= 0:
                            continue

                        # 市價做空進場
                        self.sell(data=data, size=size)
                        self._entered_today[data] = bar_date

                        # 掛出止盈 (Limit) 和止損 (Stop)
                        tp_p = round(price * (1 - self.params.tp_pct / 100.0), 4)
                        sl_p = round(price * (1 + self.params.sl_pct / 100.0), 4)

                        if self.params.tp_pct > 0:
                            self._pending_tp[data] = self.buy(
                                data=data, size=size,
                                exectype=bt.Order.Limit, price=tp_p)

                        if self.params.sl_pct > 0:
                            self._pending_sl[data] = self.buy(
                                data=data, size=size,
                                exectype=bt.Order.Stop, price=sl_p)
            else:
                # 收盤前強制平倉 (15:55)
                if bar_time >= datetime.time(15, 55):
                    self._cancel_exit_orders(data)
                    self.close(data=data)

    def notify_order(self, order):
        """OCO：其中一張成交就取消另一張"""
        if order.status == order.Completed:
            data = order.data
            if order == self._pending_tp.pop(data, None):
                sl = self._pending_sl.pop(data, None)
                if sl:
                    self.cancel(sl)
            elif order == self._pending_sl.pop(data, None):
                tp = self._pending_tp.pop(data, None)
                if tp:
                    self.cancel(tp)


def run_backtrader_5min(dfs: dict, params_dict: dict):
    """
    5min 線大腦引擎入口。
    dfs: {標的名稱: DataFrame(OHLCV, datetime index)}，只含「進場日 T+1」的分鐘線
    """
    cerebro = bt.Cerebro()

    for name, df in dfs.items():
        if df is None or df.empty:
            continue
        df_copy = df.copy()
        if not isinstance(df_copy.index, pd.DatetimeIndex):
            try:
                df_copy.index = pd.to_datetime(df_copy.index)
            except Exception:
                continue

        mapping = {c: c.lower() for c in df_copy.columns}
        df_copy = df_copy.rename(columns=mapping)
        if not all(c in df_copy.columns for c in ['open', 'high', 'low', 'close', 'volume']):
            continue

        datafeed = bt.feeds.PandasData(dataname=df_copy, name=name, openinterest=-1)
        cerebro.adddata(datafeed)

    if not cerebro.datas:
        raise ValueError("沒有有效的 5min 歷史數據！請確認 API 金鑰與日期範圍。")

    cerebro.addstrategy(
        MomentumShort5minStrategy,
        stake_mode=params_dict.get('stake_mode', 'shares'),
        stake_val=float(params_dict.get('stake_val', 100.0)),
        tp_pct=float(params_dict.get('tp_pct', 15.0)),
        sl_pct=float(params_dict.get('sl_pct', 5.0)),
    )

    cerebro.broker.setcash(params_dict.get('starting_cash', 100000))
    if params_dict.get('is_fixed_comm', False):
        comminfo = FixedCommInfo(commission=params_dict.get('commission_val', 5.0))
        cerebro.broker.addcommissioninfo(comminfo)
    else:
        cerebro.broker.setcommission(commission=params_dict.get('commission_val', 0.001))

    cerebro.addanalyzer(bt.analyzers.TimeReturn, _name='time_return')
    cerebro.addanalyzer(bt.analyzers.DrawDown, _name='drawdown')
    cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name='sharpe',
                        timeframe=bt.TimeFrame.Days, compression=1, factor=252, riskfreerate=0.0)

    results = cerebro.run()
    strat = results[0]

    final_value = cerebro.broker.getvalue()
    time_return = strat.analyzers.time_return.get_analysis()
    drawdown_info = strat.analyzers.drawdown.get_analysis()
    sharpe = strat.analyzers.sharpe.get_analysis().get('sharperatio', 0.0) or 0.0

    equity_df = pd.DataFrame(list(time_return.items()), columns=['Date', 'Daily_Return'])
    equity_df.set_index('Date', inplace=True)
    equity_df['Cumulative_Return'] = (1 + equity_df['Daily_Return']).cumprod() - 1

    logs_df = pd.DataFrame(strat.trade_logs)
    if not logs_df.empty:
        logs_df = logs_df.sort_values(by='出場時間').reset_index(drop=True)
        total_trades = len(logs_df)
        win_rate = len(logs_df[logs_df['淨獲利(USD)'] > 0]) / total_trades * 100
    else:
        total_trades, win_rate = 0, 0.0

    metrics = {
        'final_value': final_value,
        'total_return_pct': (final_value / params_dict.get('starting_cash', 100000) - 1) * 100,
        'mdd_pct': drawdown_info.max.drawdown if 'max' in drawdown_info else 0.0,
        'total_trades': total_trades,
        'win_rate': win_rate,
        'sharpe': sharpe,
    }
    return metrics, equity_df, logs_df
