import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { ISeriesApi, CandlestickData, LineData, Time } from 'lightweight-charts';

interface ChartProps {
  data: any[];
  smaWindow?: number;
  smaWindow2?: number;
  showSma?: boolean;
}

export const TradingViewChart: React.FC<ChartProps> = ({ data, smaWindow = 20, smaWindow2 = 50, showSma = true }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const sma2SeriesRef = useRef<ISeriesApi<'Line', Time> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#111827' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: '#1F2937' },
        horzLines: { color: '#1F2937' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 480,
      timeScale: {
        borderColor: '#374151',
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    const smaSeries = chart.addSeries(LineSeries, {
      color: '#F59E0B',
      lineWidth: 2,
      title: `SMA ${smaWindow}`,
    });

    const sma2Series = chart.addSeries(LineSeries, {
      color: '#3B82F6',
      lineWidth: 2,
      title: `SMA ${smaWindow2}`,
    });

    candleSeriesRef.current = candleSeries;
    smaSeriesRef.current = smaSeries;
    sma2SeriesRef.current = sma2Series;
    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [smaWindow, smaWindow2]);

  useEffect(() => {
    if (!candleSeriesRef.current || !smaSeriesRef.current || !sma2SeriesRef.current || !data) return;

    // Filter and map candlestick data
    const candles: CandlestickData[] = data.map(d => ({
      time: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    candleSeriesRef.current.setData(candles);

    if (showSma) {
      const smaData: LineData[] = data
        .filter(d => d.sma !== undefined && d.sma !== null)
        .map(d => ({
          time: d.time,
          value: d.sma,
        }));
      smaSeriesRef.current.setData(smaData);

      const sma2Data: LineData[] = data
        .filter(d => d.sma2 !== undefined && d.sma2 !== null)
        .map(d => ({
          time: d.time,
          value: d.sma2,
        }));
      sma2SeriesRef.current.setData(sma2Data);
    } else {
      smaSeriesRef.current.setData([]);
      sma2SeriesRef.current.setData([]);
    }

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [data, showSma]);

  return (
    <div className="w-full bg-gray-900 p-4 rounded-2xl border border-gray-800 shadow-2xl">
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
};
export default TradingViewChart;
