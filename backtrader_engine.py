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

class MomentumShortStrategy(bt.Strategy):
    """暴漲放空策略：具備時間停損與動態 SL/TP"""
    params = (
        ('cond1_pct', 90.0),
        ('cond2_pct', 70.0),
        ('stake', 100),
        ('tp_pct', 0.0),
        ('sl_pct', 0.0),
        ('max_hold', 1),
    )

    def __init__(self):
        self.hold_days = 0

    def next(self):
        if not self.position:
            if len(self.data) >= 2:
                ret_t = (self.data.close[0] / self.data.close[-1] - 1.0) * 100.0
                body_t = (self.data.close[0] / self.data.open[0] - 1.0) * 100.0
                
                if ret_t >= self.params.cond1_pct and body_t >= self.params.cond2_pct:
                    self.sell(size=self.params.stake)
                    self.hold_days = 0
        else:
            self.hold_days += 1
            # 做空獲利計算：(賣出價 - 現在收盤價) / 賣出價
            current_pct = (self.position.price - self.data.close[0]) / self.position.price * 100.0
            
            # 停利出場 (Take Profit)
            if self.params.tp_pct > 0 and current_pct >= self.params.tp_pct:
                self.close()
                return
                
            # 停損出場 (Stop Loss)
            if self.params.sl_pct > 0 and current_pct <= -self.params.sl_pct:
                self.close()
                return
                
            # 時間停損 (最大持有天數)
            if self.hold_days >= self.params.max_hold:
                self.close()
                return

class DualSMAStrategy(bt.Strategy):
    """雙均線做多策略，支援動態止盈止損"""
    params = (
        ('fast', 20),
        ('slow', 60),
        ('stake', 100),
        ('tp_pct', 15.0),  # Take profit
        ('sl_pct', 5.0),   # Stop loss
    )

    def __init__(self):
        self.fast_sma = bt.indicators.SimpleMovingAverage(self.data.close, period=self.params.fast)
        self.slow_sma = bt.indicators.SimpleMovingAverage(self.data.close, period=self.params.slow)
        self.crossover = bt.indicators.CrossOver(self.fast_sma, self.slow_sma)

    def next(self):
        if not self.position:
            if self.crossover > 0:
                self.buy(size=self.params.stake)
        else:
            # 死亡交叉優先平倉
            if self.crossover < 0:
                self.close()
                return

            # 如果沒有死亡交叉，檢查止損止盈
            current_pct = (self.data.close[0] - self.position.price) / self.position.price * 100.0
            
            # 停利出場 (Take Profit)
            if self.params.tp_pct > 0 and current_pct >= self.params.tp_pct:
                self.close()
                return
                
            # 停損出場 (Stop Loss)
            if self.params.sl_pct > 0 and current_pct <= -self.params.sl_pct:
                self.close()
                return

def run_backtrader(df: pd.DataFrame, params_dict: dict):
    if not isinstance(df.index, pd.DatetimeIndex):
        try:
            if 'Date' in df.columns:
                df['Date'] = pd.to_datetime(df['Date'])
                df.set_index('Date', inplace=True)
            elif 'date' in df.columns:
                df['date'] = pd.to_datetime(df['date'])
                df.set_index('date', inplace=True)
        except Exception:
            pass
            
    mapping = {c: c.lower() for c in df.columns}
    df = df.rename(columns=mapping)
    for col in ['open', 'high', 'low', 'close', 'volume']:
        if col not in df.columns:
            raise ValueError(f"請確保 CSV 包含欄位: {col}")
            
    datafeed = bt.feeds.PandasData(dataname=df, openinterest=-1)
    
    cerebro = bt.Cerebro()
    cerebro.adddata(datafeed)
    
    # 掛載策略
    if params_dict.get('strategy') == 'momentum_short':
        cerebro.addstrategy(
            MomentumShortStrategy, 
            cond1_pct=float(params_dict.get('cond1_pct', 90.0)),
            cond2_pct=float(params_dict.get('cond2_pct', 70.0)),
            stake=int(params_dict.get('stake', 100)),
            tp_pct=float(params_dict.get('tp_pct', 0.0)),
            sl_pct=float(params_dict.get('sl_pct', 0.0)),
            max_hold=int(params_dict.get('max_hold', 1))
        )
    else:
        cerebro.addstrategy(
            DualSMAStrategy, 
            fast=int(params_dict.get('sma_fast', 20)), 
            slow=int(params_dict.get('sma_slow', 60)),
            stake=int(params_dict.get('stake', 100)),
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
    trades_info = analyzers.trades.get_analysis()
    sharpe_info = analyzers.sharpe.get_analysis()
    
    equity_df = pd.DataFrame(list(time_return.items()), columns=['Date', 'Daily_Return'])
    equity_df.set_index('Date', inplace=True)
    equity_df['Cumulative_Return'] = (1 + equity_df['Daily_Return']).cumprod() - 1
    
    total_trades = trades_info.total.closed if hasattr(trades_info, 'total') and 'closed' in trades_info.total else 0
    if total_trades > 0 and hasattr(trades_info, 'won'):
        win_rate = (trades_info.won.total / total_trades) * 100
    else:
        win_rate = 0.0
        
    sharpe = sharpe_info.get('sharperatio', 0.0)
    sharpe = sharpe if sharpe is not None else 0.0
    
    metrics = {
        "final_value": final_value,
        "total_return_pct": (final_value / params_dict.get('starting_cash', 100000) - 1) * 100,
        "mdd_pct": drawdown_info.max.drawdown if 'max' in drawdown_info else 0.0,
        "total_trades": total_trades,
        "win_rate": win_rate,
        "sharpe": sharpe
    }
    
    return metrics, equity_df
