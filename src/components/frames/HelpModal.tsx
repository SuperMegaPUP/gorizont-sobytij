'use client';

import React, { useState, useEffect, useMemo, startTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, X, AlertTriangle, TrendingUp, Calendar, ChevronLeft, ChevronRight, Shield, Activity, Radio, Bot, Zap, RefreshCw, Database } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { PATTERNS, PATTERN_DESCRIPTIONS } from '@/lib/static-data';

// ─── CalendarDay Type ────────────────────────────────────────────────────────

interface CalendarDay {
  date: string;
  stock: { isTraded: boolean; reason: string; sessionDate: string | null };
  futures: { isTraded: boolean; reason: string; sessionDate: string | null };
  currency: { isTraded: boolean; reason: string; sessionDate: string | null };
}

// ─── Pattern Descriptions imported from static-data.ts ────────────────────────


// ─── Anomaly Description (only used in HelpModal) ───────────────────────────

const ANOMALY_DESCRIPTION = {
  what: 'Аномалия — это необычная торговая активность, которая выходит за рамки нормального поведения рынка. Система определяет аномалии на основе 3-уровневой детекции: HFT (суб-секундные алгоритмы, окно 3 сек), АЛГО (алгоритмические стратегии, окно 2 мин), СТРУКТУР (крупные позиционные игроки, окно 30 мин). Аномалия фиксируется когда confidence > 0.85 и доля от дневного объёма > 0.5%. Аномалии живут 10 минут и мигают 1 минуту после появления.',
  types: [
    'HFT-всплеск — суб-секундная серия сделок одного направления (окно 3 сек, уровень HFT) — высокочастотный алгоритм',
    'АЛГО-серия — алгоритмическая стратегия, серия сделок за 2 мин (уровень АЛГО) — айсберг, скальпер, моментум',
    'СТРУКТУР-позиция — крупный позиционный игрок за 30 мин (уровень СТРУКТУР) — шлифовщик, накопление',
    'Ценовой сдвиг — сделка вызвала движение цены > 0.3% за короткое время',
    'Кластерная активность — множество роботов одновременно активны в одном тикере',
  ],
  howToReact: [
    'Не паникуйте — аномалия может быть как возможностью, так и риском',
    'Проверьте новости — часто аномалия вызвана информационным поводом',
    'Дождитесь подтверждения — одно аномальное событие может быть случайным',
    'Используйте стоп-лоссы — аномальная волатильность может ударить по обе стороны',
    'Следите за направлением аномалии — если это покупка, крупный игрок что-то знает',
    'Не торгуйте против аномалии — крупный игрок обычно побеждает в краткосрочной перспективе',
  ],
};

// ─── Column Descriptions (only used in HelpModal) ───────────────────────────

const COLUMN_DESCRIPTIONS: { name: string; description: string }[] = [
  {
    name: 'Уверенность',
    description: 'Степень уверенности системы в том, что обнаруженная активность действительно является роботизированной. Рассчитывается от 0 до 1 на основе комбинации факторов: частота сделок, объём, отклонение от нормального поведения, совпадение с паттерном. Чем выше уверенность, тем выше вероятность, что это именно алгоритмическая торговля, а не обычная рыночная активность. Значения выше 0.85 — аномалия (сильный сигнал), 0.6-0.85 — умеренный, ниже 0.6 — слабый, требует подтверждения.',
  },
  {
    name: 'WAP',
    description: 'Weighted Average Price — средневзвешенная цена исполнения сделок в рамках обнаруженного паттерна. Рассчитывается как (сумма цена * объём) / общий объём всех сделок в серии. WAP показывает реальную среднюю цену, по которой робот набирает или сбрасывает позицию, а не просто последнюю цену сделки. Если WAP значительно отличается от текущей рыночной цены, это может указывать на скрытое исполнение в разные моменты времени.',
  },
  {
    name: 'Дельта',
    description: 'Разница между объёмом покупок и продаж в рамках обнаруженного паттерна (лоты покупок минус лоты продаж). Положительная дельта означает преобладание покупок (бычий давление), отрицательная — преобладание продаж (медвежье давление). Дельта показывает направленность намерений крупного игрока. Чем больше абсолютное значение дельты, тем сильнее направленное давление.',
  },
  {
    name: 'Длит.',
    description: 'Длительность обнаруженного паттерна — время от первой до последней сделки в серии. Короткая длительность (секунды) характерна для скальперов и HFT-алгоритмов, средняя (минуты) — для моментума и айсберга, длинная (десятки минут) — для шлифовщиков и стратегий накопления. Длительность помогает определить тип алгоритма и его намерения.',
  },
  {
    name: 'SCORE',
    description: 'Composite Score — композитная оценка значимости роботной активности по тикеру. SCORE = aggression × persistence × (0.3 + 0.7 × volumeAnomaly) × algoConfirm × 100. Aggression — насколько давление одностороннее (0=нейтрально, 1=чисто в одну сторону). Persistence — устойчивость программы (6+ событий = максимум). VolumeAnomaly — аномалия объёма относительно медианы по всем тикерам. AlgoConfirm — кросс-подтверждение из AlgoPack: ×1.2 (СТАКАН), ×1.3 (ЛОКАТОР), ×1.5 (оба). SCORE не зависит от VOLTODAY, времени дня или новостей — он сравнивает активность тикера с самой собой. Абсолютная шкала [0-100]: SCORE > 50 = сильный сигнал, SCORE > 25 = значимый.',
  },
  {
    name: 'Цена',
    description: 'Ценовое воздействие (price impact) — насколько паттерн сдвинул цену инструмента. Положительное значение означает рост цены (давление покупателей), отрицательное — снижение (давление продавцов). Показатель выражен в процентах изменения цены. Значение выше 0.3% — значительное воздействие, указывающее на агрессивное исполнение. Комбинируйте с направлением паттерна для оценки силы сигнала.',
  },
  {
    name: 'Спред',
    description: 'Воздействие на спред (spread impact) — как паттерн повлиял на разницу между лучшей ценой покупки и продажи. Отрицательное значение — спред сузился (ликвидность улучшилась, характерно для маркет-мейкеров). Положительное значение — спред расширился (ликвидность ухудшилась, характерно для агрессивных сделок, "съевших" один уровень стакана). Резкое расширение спреда — сигнал "спред-шока", возможна повышенная волатильность.',
  },
];

// ─── Help Modal (F2) ────────────────────────────────────────────────────────

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'calendar' | 'patterns' | 'smart_money' | 'anomalies' | 'radar'>('calendar');
  const calendarDays = useDashboardStore((s) => s.calendarDays);
  const updateCalendar = useDashboardStore((s) => s.updateCalendar);
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState('');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'F2') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Подгрузка данных при открытии или смене года
  useEffect(() => {
    if (activeTab !== 'calendar') return;
    const year = calMonth.year;
    const existing = calendarDays.some(d => d.date.startsWith(`${year}-`));
    if (existing) return;
    startTransition(() => {
      setCalLoading(true);
      setCalError('');
    });
    fetch(`/api/calendar?from=${year}-01-01&till=${year}-12-31`)
      .then(res => res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`))
      .then(data => {
        if (data.days && data.days.length > 0) {
          const merged = [...useDashboardStore.getState().calendarDays, ...data.days]
            .filter((d, i, a) => a.findIndex(x => x.date === d.date) === i)
            .sort((a, b) => a.date.localeCompare(b.date));
          updateCalendar(merged);
        } else if (data.error) {
          setCalError(data.error);
        }
      })
      .catch(e => setCalError(String(e)))
      .finally(() => setCalLoading(false));
  }, [activeTab, calMonth.year, calendarDays, updateCalendar]);

  // Календарные данные для текущего месяца
  const calendarGrid = useMemo(() => {
    const { year, month } = calMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay(); // 0=Sun
    const daysInMonth = lastDay.getDate();
    const days: { date: number; dateStr: string; dayData?: CalendarDay }[] = [];

    // Паддинги до начала месяца
    for (let i = 0; i < (startDow === 0 ? 6 : startDow - 1); i++) {
      days.push({ date: 0, dateStr: '' });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = calendarDays.find((c) => c.date === dateStr);
      days.push({ date: d, dateStr, dayData });
    }
    return days;
  }, [calMonth, calendarDays]);

  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  const getDayCellClass = (day: typeof calendarGrid[0]) => {
    if (day.date === 0) return '';
    const d = day.dayData;
    if (!d) return 'bg-[var(--terminal-border)]/30'; // нет данных
    const allClosed = !d.stock.isTraded && !d.futures.isTraded && !d.currency.isTraded;
    const allOpen = d.stock.isTraded && d.futures.isTraded && d.currency.isTraded;
    if (allClosed) return 'bg-[var(--terminal-negative)]/15 border border-[var(--terminal-negative)]/30';
    if (allOpen) return 'bg-[var(--terminal-positive)]/10 border border-[var(--terminal-positive)]/20';
    // Частично открыт
    return 'bg-[var(--terminal-warning)]/10 border border-[var(--terminal-warning)]/20';
  };

  const getMarketIcon = (isTraded: boolean) => isTraded ? <span className="text-[var(--terminal-positive)]">{'\u2713'}</span> : <span className="text-[var(--terminal-negative)]">{'\u2717'}</span>;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-[var(--terminal-bg)] border border-[var(--terminal-border)] rounded-lg max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)] shrink-0">
          <div className="flex items-center gap-3">
            <HelpCircle className="w-5 h-5 text-[var(--terminal-accent)]" />
            <h2 className="text-sm font-bold text-[var(--terminal-text)] tracking-wide">СПРАВОЧНИК</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-[var(--terminal-muted)] font-mono">F2 / Esc — закрыть</span>
            <button onClick={onClose} className="text-[var(--terminal-muted)] hover:text-[var(--terminal-text)] transition-colors p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--terminal-border)] overflow-x-auto shrink-0 min-h-[40px]">
          <button
            onClick={() => setActiveTab('calendar')}
            className={`px-4 py-2.5 text-xs font-bold font-mono transition-colors whitespace-nowrap ${activeTab === 'calendar' ? 'text-[var(--terminal-warning)] border-b-2 border-[var(--terminal-warning)] bg-[var(--terminal-warning)]/5' : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'}`}
          >
            <Calendar className="w-3 h-3 inline mr-1" />КАЛЕНДАРЬ
          </button>
          <button
            onClick={() => setActiveTab('patterns')}
            className={`px-4 py-2.5 text-xs font-bold font-mono transition-colors whitespace-nowrap ${activeTab === 'patterns' ? 'text-[var(--terminal-accent)] border-b-2 border-[var(--terminal-accent)] bg-[var(--terminal-accent)]/5' : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'}`}
          >
            ПАТТЕРНЫ
          </button>
          <button
            onClick={() => setActiveTab('smart_money')}
            className={`px-4 py-2.5 text-xs font-bold font-mono transition-colors whitespace-nowrap ${activeTab === 'smart_money' ? 'text-[var(--terminal-positive)] border-b-2 border-[var(--terminal-positive)] bg-[var(--terminal-positive)]/5' : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'}`}
          >
            <TrendingUp className="w-3 h-3 inline mr-1" />SMART MONEY
          </button>
          <button
            onClick={() => setActiveTab('anomalies')}
            className={`px-4 py-2.5 text-xs font-bold font-mono transition-colors whitespace-nowrap ${activeTab === 'anomalies' ? 'text-[var(--terminal-warning)] border-b-2 border-[var(--terminal-warning)] bg-[var(--terminal-warning)]/5' : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'}`}
          >
            АНОМАЛИИ
          </button>
          <button
            onClick={() => setActiveTab('radar')}
            className={`px-4 py-2.5 text-xs font-bold font-mono transition-colors whitespace-nowrap ${activeTab === 'radar' ? 'text-[var(--terminal-accent)] border-b-2 border-[var(--terminal-accent)] bg-[var(--terminal-accent)]/5' : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'}`}
          >
            <Radio className="w-3 h-3 inline mr-1" />РАДАР
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto terminal-scroll p-5">
          {(() => {
            if (activeTab === 'calendar') return (
            <div className="space-y-4">
              <p className="text-[10px] text-[var(--terminal-muted)] mb-2">
                Календарь неторговых дней Московской биржи. Данные из <a href="https://moexalgo.github.io/docs/api/calendar-iss-calendars-root" target="_blank" rel="noopener noreferrer" className="text-[var(--terminal-accent)] underline">MOEX API</a>. Обновляются автоматически при открытии справки.
              </p>

              {/* Легенда */}
              <div className="flex items-center gap-4 text-[9px] font-mono mb-3">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[var(--terminal-positive)]/10 border border-[var(--terminal-positive)]/20" /> Открыто</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[var(--terminal-warning)]/10 border border-[var(--terminal-warning)]/20" /> Частично</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[var(--terminal-negative)]/15 border border-[var(--terminal-negative)]/30" /> Закрыто</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[var(--terminal-border)]/30" /> Нет данных</span>
              </div>

              {/* Навигация по месяцам */}
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setCalMonth(prev => {
                  const m = prev.month === 0 ? 11 : prev.month - 1;
                  const y = prev.month === 0 ? prev.year - 1 : prev.year;
                  return { year: y, month: m };
                })} className="p-1 hover:bg-[var(--terminal-border)] rounded transition-colors text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-bold text-[var(--terminal-text)] font-mono">{monthNames[calMonth.month]} {calMonth.year}</span>
                <button onClick={() => setCalMonth(prev => {
                  const m = prev.month === 11 ? 0 : prev.month + 1;
                  const y = prev.month === 11 ? prev.year + 1 : prev.year;
                  return { year: y, month: m };
                })} className="p-1 hover:bg-[var(--terminal-border)] rounded transition-colors text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Заголовки дней недели */}
              <div className="grid grid-cols-7 gap-1 text-[8px] font-mono text-[var(--terminal-muted)] mb-1">
                <span className="text-center">Пн</span>
                <span className="text-center">Вт</span>
                <span className="text-center">Ср</span>
                <span className="text-center">Чт</span>
                <span className="text-center">Пт</span>
                <span className="text-center text-[var(--terminal-negative)]/60">Сб</span>
                <span className="text-center text-[var(--terminal-negative)]/60">Вс</span>
              </div>

              {/* Сетка календаря */}
              <div className="grid grid-cols-7 gap-1">
                {calendarGrid.map((day, i) => (
                  <div
                    key={i}
                    className={`relative rounded p-1 text-center min-h-[48px] ${getDayCellClass(day)} ${day.date === 0 ? 'opacity-0' : ''}`}
                    title={day.dayData ? `ФР: ${day.dayData.stock.isTraded ? 'открыт' : day.dayData.stock.reason}\nСР: ${day.dayData.futures.isTraded ? 'открыт' : day.dayData.futures.reason}\nВР: ${day.dayData.currency.isTraded ? 'открыт' : day.dayData.currency.reason}` : ''}
                  >
                    {day.date > 0 && (
                      <>
                        <span className="text-[10px] font-bold text-[var(--terminal-text)]">{day.date}</span>
                        {day.dayData && (
                          <div className="flex justify-center gap-0.5 mt-0.5">
                            <span className="text-[7px]">{getMarketIcon(day.dayData.stock.isTraded)}</span>
                            <span className="text-[7px]">{getMarketIcon(day.dayData.futures.isTraded)}</span>
                            <span className="text-[7px]">{getMarketIcon(day.dayData.currency.isTraded)}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Расшифровка рынков */}
              <div className="border border-[var(--terminal-border)] rounded-md overflow-hidden mt-4">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                  <span className="text-sm font-bold text-[var(--terminal-text)]">Обозначения рынков</span>
                </div>
                <div className="px-4 py-3 space-y-2 text-[10px] font-mono">
                  <div className="flex items-center gap-3">
                    <span className="text-[var(--terminal-accent)]">1-й значок</span>
                    <span className="text-[var(--terminal-neutral)]">Фондовый рынок (акции, облигации)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[var(--terminal-warning)]">2-й значок</span>
                    <span className="text-[var(--terminal-neutral)]">Срочный рынок (фьючерсы, опционы)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[var(--terminal-accent)]">3-й значок</span>
                    <span className="text-[var(--terminal-neutral)]">Валютный рынок (SWAP, репо)</span>
                  </div>
                </div>
              </div>

              {/* Индикатор загрузки / ошибка */}
              {calLoading && (
                <div className="flex items-center gap-2 text-[10px] text-[var(--terminal-accent)] font-mono mt-2">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Загрузка календаря...
                </div>
              )}
              {calError && (
                <div className="flex items-center gap-2 text-[10px] text-[var(--terminal-negative)] font-mono mt-2">
                  <AlertTriangle className="w-3 h-3" /> Ошибка: {calError}
                </div>
              )}
              {!calLoading && calendarDays.length === 0 && !calError && (
                <div className="flex items-center gap-2 text-[10px] text-[var(--terminal-warning)] font-mono mt-2">
                  <Database className="w-3 h-3" /> Данные не загружены
                </div>
              )}

              {/* Таблица неторговых дней текущего месяца */}
              <div className="border border-[var(--terminal-border)] rounded-md overflow-hidden mt-3">
                <div className="flex items-center justify-between px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-[var(--terminal-negative)]" />
                    <span className="text-sm font-bold text-[var(--terminal-text)]">Неторговые дни — {monthNames[calMonth.month]}</span>
                  </div>
                  {calendarDays.length > 0 && (
                    <span className="text-[8px] text-[var(--terminal-muted)] font-mono">{calendarDays.filter(d => d.date.startsWith(`${calMonth.year}-`)).length} дн. загружено</span>
                  )}
                </div>
                <div className="px-4 py-2">
                  {(() => {
                    const closedDays = calendarGrid.filter(d => d.dayData && (!d.dayData.stock.isTraded || !d.dayData.futures.isTraded || !d.dayData.currency.isTraded));
                    if (closedDays.length === 0) return <p className="text-[10px] text-[var(--terminal-muted)] font-mono py-2">{calendarDays.length === 0 ? 'Данные не загружены' : 'Неторговых дней в этом месяце не найдено'}</p>;
                    return (
                      <table className="w-full text-[9px] font-mono">
                        <thead>
                          <tr className="text-[var(--terminal-muted)]">
                            <th className="text-left py-1 pr-2">Дата</th>
                            <th className="text-center py-1 px-1">ФР</th>
                            <th className="text-center py-1 px-1">СР</th>
                            <th className="text-center py-1 px-1">ВР</th>
                            <th className="text-left py-1 pl-2">Причина</th>
                          </tr>
                        </thead>
                        <tbody>
                          {closedDays.map(d => (
                            <tr key={d.dateStr} className="border-t border-[var(--terminal-border)]/30">
                              <td className="py-1 pr-2 text-[var(--terminal-text)]">{d.dateStr}</td>
                              <td className="py-1 px-1 text-center">{getMarketIcon(d.dayData!.stock.isTraded)}</td>
                              <td className="py-1 px-1 text-center">{getMarketIcon(d.dayData!.futures.isTraded)}</td>
                              <td className="py-1 px-1 text-center">{getMarketIcon(d.dayData!.currency.isTraded)}</td>
                              <td className="py-1 pl-2 text-[var(--terminal-neutral)]">
                                {[d.dayData!.stock.reason, d.dayData!.futures.reason, d.dayData!.currency.reason].filter((v, i, a) => v && a.indexOf(v) === i).join(', ')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
            if (activeTab === 'patterns') return (
            <div className="space-y-4">
              <p className="text-[10px] text-[var(--terminal-muted)] mb-4">
                Ниже описаны все детектируемые паттерны алгоритмической торговли. Для каждого паттерна указано, как он распознаётся системой и как эту информацию можно использовать в торговле.
              </p>
              {PATTERN_DESCRIPTIONS.map((p) => {
                const patIdx = PATTERNS.findIndex(pp => pp.name === p.name);
                const colorVar = patIdx >= 0 ? `var(--terminal-chart-pattern-${patIdx + 1})` : 'var(--terminal-muted)';
                return (
                <div key={p.name} className="border border-[var(--terminal-border)] rounded-md overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colorVar }} />
                    <span className="text-sm font-bold text-[var(--terminal-text)]">{p.name}</span>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    <div>
                      <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">Как рассчитывается</span>
                      <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">{p.calculation}</p>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-[var(--terminal-positive)] uppercase tracking-wider">Как использовать в трейдинге</span>
                      <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">{p.trading}</p>
                    </div>
                  </div>
                </div>
              );
              })}
            </div>
          );
            if (activeTab === 'smart_money') return (
            <div className="space-y-4">
              <p className="text-[10px] text-[var(--terminal-muted)] mb-4">
                Smart Money Index (SMI) — индекс «умных денег», показывающий направление позиций юридических лиц (крупных игроков) на рынке фьючерсов ФОРТС. Рассчитывается на основе данных об открытом интересе (FUTOI) с обновлением каждые 5 минут. Источник данных: MOEX ISS openpositions (основной, бесплатный) с fallback на MOEX APIM (платный).
              </p>

              {/* Формула SMI */}
              <div className="border border-[var(--terminal-positive)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-positive)]/10 border-b border-[var(--terminal-positive)]/30">
                  <TrendingUp className="w-4 h-4 text-[var(--terminal-positive)]" />
                  <span className="text-sm font-bold text-[var(--terminal-positive)]">Формула SMI</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <p className="text-[10px] text-[var(--terminal-text)] font-bold font-mono">
                    SMI = (0.4 x Direction + 0.3 x Concentration + 0.3 x Divergence) x 100
                  </p>
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    Диапазон: от -100 (экстремально медвежий) до +100 (экстремально бычий).
                  </p>
                </div>
              </div>

              {/* Direction */}
              <div className="border border-[var(--terminal-border)] rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                  <span className="w-3 h-3 rounded-full shrink-0 bg-[var(--terminal-accent)]" />
                  <span className="text-sm font-bold text-[var(--terminal-text)]">Direction (вес 40%)</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    Направление чистой позиции юридических лиц. Если ЮЛ в нетто-лонге — direction = +1, если в нетто-шорте — direction = -1. Сила направления (strength) = min(|yur.pos| / (totalOI / 2), 1), где totalOI — суммарный открытый интерес всех групп. Итоговое значение = direction x strength. Чем сильнее перекос позиции ЮЛ, тем ближе strength к 1.
                  </p>
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    <b className="text-[var(--terminal-text)]">Логика</b>: Юридические лица — это банки, фонды, управляющие компании. Их совокупная позиция отражает «институциональное мнение» о направлении рынка. Вес 40% — самый высокий, так как направление — главный индикатор.
                  </p>
                </div>
              </div>

              {/* Concentration */}
              <div className="border border-[var(--terminal-border)] rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                  <span className="w-3 h-3 rounded-full shrink-0 bg-[var(--terminal-accent)]" />
                  <span className="text-sm font-bold text-[var(--terminal-text)]">Concentration (вес 30%)</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    Концентрация лиц на одной стороне рынка. Если ЮЛ в лонге — ratio = pos_long_num / (pos_long_num + pos_short_num). Если в шорте — ratio = pos_short_num / total. Итоговое значение = ratio x 2 - 1 (нормализация от 0..1 к -1..+1). Высокая концентрация означает, что большинство лиц стоят на одной стороне — это усиливает направленный сигнал.
                  </p>
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    <b className="text-[var(--terminal-text)]">Логика</b>: Если 90% лиц в лонге и только 10% в шорте — это консенсус, который усиливает направленный сигнал. Если 50/50 — консенсуса нет, concentration близок к 0.
                  </p>
                </div>
              </div>

              {/* Divergence */}
              <div className="border border-[var(--terminal-border)] rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                  <span className="w-3 h-3 rounded-full shrink-0 bg-[var(--terminal-warning)]" />
                  <span className="text-sm font-bold text-[var(--terminal-text)]">Divergence (вес 30%)</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    Расхождение между позициями юридических и физических лиц. Учитывается ТОЛЬКО когда ЮЛ и ФЛ в разных направлениях (один в лонге, другой в шорте). Значение = (направление ЮЛ) x min(|yur.pos - fiz.pos| / (totalOI / 2), 1). Если обе группы в одном направлении — divergence = 0.
                  </p>
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    <b className="text-[var(--terminal-text)]">Логика</b>: Когда «умные деньги» (ЮЛ) в лонге, а «толпа» (ФЛ) в шорте — это бычий дивергенс: институции правы чаще толпы. И наоборот. Чем больше разница позиций, тем сильнее дивергенс. Вес 30% — значимый, но не доминирующий фактор.
                  </p>
                </div>
              </div>

              {/* Composite SMI */}
              <div className="border border-[var(--terminal-accent)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-accent)]/10 border-b border-[var(--terminal-accent)]/30">
                  <Activity className="w-4 h-4 text-[var(--terminal-accent)]" />
                  <span className="text-sm font-bold text-[var(--terminal-accent)]">Composite SMI (сводный индекс)</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    Средневзвешенное значение SMI по 4 фьючерсам: <b className="text-[var(--terminal-text)]">MX (Индекс Мосбиржи) = вес 0.40</b>, <b className="text-[var(--terminal-text)]">Si (Доллар/рубль) = вес 0.25</b>, <b className="text-[var(--terminal-text)]">RI (Индекс РТС) = вес 0.20</b>, <b className="text-[var(--terminal-text)]">BR (Нефть Brent) = вес 0.15</b>. MX имеет наибольший вес как главный индикатор российского рынка. Si — второй по важности как индикатор валютного риска.
                  </p>
                  <p className="text-[10px] text-[var(--terminal-text)] font-bold">
                    Пороги направления Composite SMI:
                  </p>
                  <div className="text-[10px] text-[var(--terminal-neutral)] space-y-1 ml-2">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[var(--terminal-positive)]"></span> SMI &gt; 30: <b className="text-[var(--terminal-positive)]">bullish</b> (бычий)</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[var(--terminal-positive)]"></span> SMI &gt; 10: <b className="text-[var(--terminal-positive)]">slightly_bullish</b> (умеренно бычий)</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[var(--terminal-warning)]"></span> SMI от -10 до +10: <b className="text-[var(--terminal-warning)]">neutral</b> (нейтральный)</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[var(--terminal-warning)]"></span> SMI &lt; -10: <b className="text-[var(--terminal-warning)]">slightly_bearish</b> (умеренно медвежий)</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[var(--terminal-negative)]"></span> SMI &lt; -30: <b className="text-[var(--terminal-negative)]">bearish</b> (медвежий)</div>
                  </div>
                </div>
              </div>

              {/* Как использовать */}
              <div className="border border-[var(--terminal-positive)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-positive)]/10 border-b border-[var(--terminal-positive)]/30">
                  <span className="text-sm font-bold text-[var(--terminal-positive)]">Как использовать SMI в трейдинге</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-positive)] mt-0.5 shrink-0">1.</span>
                    <span className="text-[var(--terminal-neutral)]"><b className="text-[var(--terminal-text)]">Контрариантная стратегия</b>: SMI &lt; -30 (медвежий) — толпа продаёт, умные деньги покупают. Ищите возможность для покупок. SMI &gt; 30 (бычий) — умные деньги в лонге, подтверждение тренда.</span>
                  </div>
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-positive)] mt-0.5 shrink-0">2.</span>
                    <span className="text-[var(--terminal-neutral)]"><b className="text-[var(--terminal-text)]">Дивергенция ЮЛ/ФЛ</b>: Если юридические и физические лица в разных направлениях — следуйте за ЮЛ. Институции правы чаще. Divergence-компонент усиливает сигнал когда разрыв большой.</span>
                  </div>
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-positive)] mt-0.5 shrink-0">3.</span>
                    <span className="text-[var(--terminal-neutral)]"><b className="text-[var(--terminal-text)]">Мульти-подтверждение</b>: Комбинируйте SMI с LIVE RADAR. Если SMI бычий + в RADAR видны айсберги на покупку и моментум — мощный бычий конвергенс. Если SMI бычий, но RADAR показывает агрессивные продажи — дивергенс, будьте осторожны.</span>
                  </div>
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-positive)] mt-0.5 shrink-0">4.</span>
                    <span className="text-[var(--terminal-neutral)]"><b className="text-[var(--terminal-text)]">Срочная структура</b>: Смотрите на отдельные фьючерсы. Если MX в лонге, а Si в шорте — рублёвый рост при падении доллара (слабый рубль). Если BR в шорте — ожидается падение нефти, давление на рубль.</span>
                  </div>
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-positive)] mt-0.5 shrink-0">5.</span>
                    <span className="text-[var(--terminal-neutral)]"><b className="text-[var(--terminal-text)]">Внутридневные развороты</b>: Резкая смена SMI с bullish на bearish или наоборот — признак смены позиций крупными игроками. FUTOI обновляется каждые 5 мин, поэтому изменения заметны почти в реальном времени.</span>
                  </div>
                </div>
              </div>
            </div>
          );
            if (activeTab === 'anomalies') return (
            <div className="space-y-4">
              <div className="border border-[var(--terminal-warning)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-warning)]/10 border-b border-[var(--terminal-warning)]/30">
                  <AlertTriangle className="w-4 h-4 text-[var(--terminal-warning)]" />
                  <span className="text-sm font-bold text-[var(--terminal-warning)]">Что такое аномалии</span>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">{ANOMALY_DESCRIPTION.what}</p>
                </div>
              </div>

              <div className="border border-[var(--terminal-border)] rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                  <span className="text-sm font-bold text-[var(--terminal-text)]">Типы аномалий</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {ANOMALY_DESCRIPTION.types.map((t, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="text-[var(--terminal-warning)] mt-0.5 shrink-0">{'\u25B8'}</span>
                      <span className="text-[var(--terminal-neutral)]">{t}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-[var(--terminal-positive)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-positive)]/10 border-b border-[var(--terminal-positive)]/30">
                  <Shield className="w-4 h-4 text-[var(--terminal-positive)]" />
                  <span className="text-sm font-bold text-[var(--terminal-positive)]">Как реагировать на аномалии</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {ANOMALY_DESCRIPTION.howToReact.map((t, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="text-[var(--terminal-positive)] mt-0.5 shrink-0">{i + 1}.</span>
                      <span className="text-[var(--terminal-neutral)]">{t}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-[var(--terminal-accent)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-accent)]/10 border-b border-[var(--terminal-accent)]/30">
                  <Activity className="w-4 h-4 text-[var(--terminal-accent)]" />
                  <span className="text-sm font-bold text-[var(--terminal-accent)]">Логика работы детектора аномалий</span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-warning)] uppercase tracking-wider">Пороги детекции</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Аномалия фиксируется когда burst (всплеск робот-активности) имеет confidence &gt; 0.85 и объём превышает 0.5% дневного оборота. Это отсекает шум: только по-настоящему крупные и уверенные всплески попадают в фрейм аномалий.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-warning)] uppercase tracking-wider">Время жизни (TTL)</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Аномалия отображается в дашборде <b className="text-[var(--terminal-text)]">10 минут</b> с момента появления. После истечения TTL аномалия плавно исчезает (снижается непрозрачность). Это достаточно долго, чтобы заметить даже если вы отвлеклись, но не перегружает фрейм старыми событиями.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-warning)] uppercase tracking-wider">Мигание</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      При появлении аномалия подсвечивается оранжевой левой рамкой на <b className="text-[var(--terminal-text)]">1 минуту</b>. Это спокойное визуальное уведомление — без агрессивного пульсирующего мигания, чтобы не отвлекать от анализа. Через минуту рамка становится тёмной — аномалия всё ещё видна, но не привлекает внимание.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">Хранение в БД</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Все аномалии по всем тикерам записываются в базу данных в момент появления. Это позволяет анализировать паттерны во времени: какие тикеры чаще всего дают аномалии, в какие часы они концентрируются, есть ли корреляция между тикерами. После обновления страницы (F5) аномалии загружаются из БД — вы не теряете историю за текущий торговый день.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">Горячие клавиши</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Нажмите <b className="text-[var(--terminal-text)]">A</b> для быстрого перехода к фрейму аномалий. Фрейм АНОМАЛИИ расположен в верхней части правой панели, рядом с индексом Страх/Жадность — два фрейма делят одну строку для компактности.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border border-[var(--terminal-border)] rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                  <span className="text-sm font-bold text-[var(--terminal-text)]">Индекс Страх/Жадность</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    Индекс рассчитывается на основе скользящего окна 30 минут с весовым коэффициентом по уверенности (confidence). Формула: (взвешенные лоты покупок / (взвешенные лоты покупок + взвешенные лоты продаж)) x 100, где каждый лот умножается на вес уверенности (0.5 для слабых сигналов, 1.5 для сильных). Затем применяется EMA-сглаживание (alpha=0.05) для плавного изменения. Значение 0 = экстремальный страх (все продают), 100 = экстремальная жадность (все покупают). Диапазон 40-60 = нейтральный рынок. Использование скользящего окна делает индекс чувствительным к свежим данным, а EMA предотвращает резкие скачки.
                  </p>
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    Как использовать: при экстремальном страхе (&lt;30) ищите возможности для покупок — рынок перепродан. При экстремальной жадности (&gt;70) будьте осторожны — возможна коррекция. Контрариантная стратегия: торгуйте против толпы на экстремумах.
                  </p>
                </div>
              </div>

              <div className="border border-[var(--terminal-border)] rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                  <span className="text-sm font-bold text-[var(--terminal-text)]">Часы работы Московской биржи</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    Московская биржа (MOEX) работает <b className="text-[var(--terminal-text)]">7 дней в неделю</b>. Расписание: <b className="text-[var(--terminal-positive)]">Будни: 06:50 — 23:49:59 МСК</b>, <b className="text-[var(--terminal-warning)]">Выходные: 09:50 — 18:59:59 МСК</b>. Подробное расписание: <a href="https://www.moex.com/s1167" target="_blank" rel="noopener noreferrer" className="text-[var(--terminal-accent)] underline">moex.com/s1167</a>. Система автоматически определяет статус биржи по московскому времени и дню недели.
                  </p>
                  <p className="text-[10px] text-[var(--terminal-neutral)] leading-relaxed">
                    Вне торговых часов новые события не поступают. Если вы видите сообщение "БИРЖА ЗАКРЫТА" — торги не проводятся, данные не обновляются. В будни биржа откроется в 06:50 МСК, в выходные — в 09:50 МСК.
                  </p>
                </div>
              </div>
            </div>
          );
            if (activeTab === 'radar') return (
            <div className="space-y-4">
              <p className="text-[10px] text-[var(--terminal-muted)] mb-4">
                Описание 6 фреймов LIVE RADAR — основного инструмента анализа робот-активности и структуры рынка в реальном времени. Фреймы 1-4 анализируют робот-торговлю за скользящее окно 30 минут с 3-уровневой детекцией (HFT / АЛГО / СТРУКТУР). Фреймы 5-6 используют данные MOEX AlgoPack (обновление каждые 5 минут) и работают по ВСЕМ тикерам Мосбиржи, включая неликвидные. Все метрики сохраняются в БД (Redis) каждые 30 сек и восстанавливаются после обновления страницы (F5).
              </p>

              {/* Фрейм 1: ТИКЕРЫ */}
              <div className="border border-[var(--terminal-accent)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-accent)]/10 border-b border-[var(--terminal-accent)]/30">
                  <Activity className="w-4 h-4 text-[var(--terminal-accent)]" />
                  <span className="text-sm font-bold text-[var(--terminal-accent)]">Фрейм 1: ТИКЕРЫ — Давление (30 мин)</span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">Что показывает</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Суммарное давление роботов по каждому тикеру за последние 30 минут. Покупки = агрессивные маркет-ордера на покупку (hit the ask), Продажи = агрессивные маркет-ордера на продажу (hit the bid). Важно: это сторона-агрессор, а не позиция. Лонгист, закрывающий позицию маркет-ордером на продажу, засчитывается в «Продажи». Дельта = разница покупок и продаж.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">SCORE — Composite Score</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      SCORE заменяет прежний «% влияния» (percentOfDay) и не зависит от оборота дня, времени суток или новостей. Формула: <b className="text-[var(--terminal-text)]">SCORE = aggression × persistence × (0.3 + 0.7 × volumeAnomaly)</b>. Три компоненты:
                    </p>
                    <div className="text-[10px] text-[var(--terminal-neutral)] space-y-1 ml-2 mt-1">
                      <div className="flex items-start gap-2"><span className="text-[var(--terminal-accent)] shrink-0">1.</span><span><b className="text-[var(--terminal-text)]">Aggression</b> (0..1) — насколько давление одностороннее. |buyLots - sellLots| / totalLots. 1.0 = чисто в одну сторону (0 покупок или 0 продаж).</span></div>
                      <div className="flex items-start gap-2"><span className="text-[var(--terminal-accent)] shrink-0">2.</span><span><b className="text-[var(--terminal-text)]">Persistence</b> (0..1) — устойчивость программы. min(events / 6, 1). 6+ событий за 30 мин = 1.0 (надёжная программа, не разовая сделка).</span></div>
                      <div className="flex items-start gap-2"><span className="text-[var(--terminal-accent)] shrink-0">3.</span><span><b className="text-[var(--terminal-text)]">VolumeAnomaly</b> (0..1) — аномалия объёма относительно медианы. log(1 + avgLotsPerEvent / medianAvgLots) / log(11). Если среднее событие тикера в 10x больше медианы = 1.0. Полоска прогресса показывает SCORE относительно максимума.</span></div>
                    </div>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-2 leading-relaxed">
                      <b className="text-[var(--terminal-warning)]">Почему SCORE лучше % влияния:</b> % влияния зависел от VOLTODAY (оборот за день). В начале торгов, когда оборот мал, % мог показывать 500%+. При выходе новости оборот взлетал, и % падал до 0.4% при том же реальном давлении. SCORE не использует VOLTODAY вообще — он сравнивает активность тикера с самой собой (медиана по всем тикерам в окне).
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-positive)] uppercase tracking-wider">Как использовать</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Высокий SCORE = тикер с сильным односторонним давлением, устойчивой программой и аномальным объёмом. Это ядро сигнала. Тикеры с высоким SCORE и направлением Пок — роботы агрессивно покупают, возможен рост. С направлением Прод — давят вниз. Нтр — борьба, неопределённость. Обращайте внимание на SCORE &gt; 0.5 — это значимая активность. Тикеры с 0 покупок или 0 продаж (aggression = 1.0) — самые чистые направленные сигналы.
                    </p>
                  </div>
                </div>
              </div>

              {/* Фрейм 2: АКТИВНОСТЬ */}
              <div className="border border-[var(--terminal-positive)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-positive)]/10 border-b border-[var(--terminal-positive)]/30">
                  <Bot className="w-4 h-4 text-[var(--terminal-positive)]" />
                  <span className="text-sm font-bold text-[var(--terminal-positive)]">Фрейм 2: ДЛИТЕЛЬНОСТЬ — Профиль роботов по тикерам</span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">Что показывает</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Разбивку робот-активности по тикерам с классификацией по длительности и типам стратегий. Цветные сегменты на полосе = разные типы роботов: <b className="text-[var(--terminal-negative)]">HFT</b> = суб-секундные алгоритмы (0-3с, интервал &lt; 0.5с), <b className="text-[var(--terminal-positive)]">Скальп</b> = мгновенные сделки (3-30с), <b className="text-[var(--terminal-warning)]">Импульс</b> = короткие серии (30с-2м), <b className="text-[var(--terminal-accent)]">Структурный</b> = среднесрочные позиции (2-10м), <b className="text-[var(--terminal-accent)]">Накопление</b> = долгие позиции (&gt; 10м). Направление: Пок — агрессивные покупки преобладают, Прод — агрессивные продажи. Важно: это сторона-агрессор (маркет-ордера), а не позиции лонг/шорт. Фрейм анализирует данные за 30-минутное скользящее окно.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-positive)] uppercase tracking-wider">Как использовать</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Если по тикеру работают в основном скальперы — ожидай высокой волатильности без явного тренда. Если структурные роботы — формируется направленное движение. Если накопление — крупный игрок набирает позицию. Комбинация типов даёт более полную картину: скальперы + импульс = краткосрочный всплеск, структурные + накопление = серьёзное позиционирование.
                    </p>
                  </div>
                </div>
              </div>

              {/* Фрейм 3: ДИНАМИКА */}
              <div className="border border-[var(--terminal-accent)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-accent)]/10 border-b border-[var(--terminal-accent)]/30">
                  <TrendingUp className="w-4 h-4 text-[var(--terminal-accent)]" />
                  <span className="text-sm font-bold text-[var(--terminal-accent)]">Фрейм 3: ДИНАМИКА — Волна покупок/продаж (5 мин)</span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">Что показывает</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Изменение давления покупок/продаж в 5-минутных окнах за последние 4 часа. Зелёная область = агрессивные покупки (маркет-ордера на покупку), красная = агрессивные продажи (маркет-ордера на продажу). Важно: это сторона-агрессор в сделке, а не позиции лонг/шорт. Лонгист, закрывающий позицию маркет-ордером на продажу, засчитывается в «Продажи». Каждая точка — агрегация всех робот-событий за 5-минутный интервал. Данные сохраняются в БД (Redis) и восстанавливаются после F5, при этом показываются только актуальные окна за последние 4 часа.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-positive)] uppercase tracking-wider">Как использовать</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Если зелёная волна нарастает — агрессивные покупки усиливаются (бычий импульс). Если красная растёт — продавцы давят (медвежий). Смена зелёной на красную = разворот настроения. Резкий пик в одну сторону = всплеск робот-активности, возможен прорыв. Равновесие зелёной и красной = борьба, консолидация. Внимание: красная область может доминировать даже на бычьем рынке, т.к. продажи маркет-ордерами активнее, а покупки часто идут через лимитные ордера (пассивная сторона).
                    </p>
                  </div>
                </div>
              </div>

              {/* Фрейм 4: СИГНАЛЫ v2 */}
              <div className="border border-[var(--terminal-warning)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-warning)]/10 border-b border-[var(--terminal-warning)]/30">
                  <Zap className="w-4 h-4 text-[var(--terminal-warning)]" />
                  <span className="text-sm font-bold text-[var(--terminal-warning)]">Фрейм 4: СИГНАЛЫ v2 — Концентрация силы (30 мин)</span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">Что показывает</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Сигналы концентрации роботов в одном направлении за последние 30 минут. <b className="text-[var(--terminal-warning)]">СИЛЬНЫЙ</b> = SCORE &gt;= 50 + 5+ событий. <b className="text-[var(--terminal-warning)]">СРЕДНИЙ</b> = SCORE &gt;= 25 + 3+ событий. Фильтр качества: минимум 5000 лотов за окно (отсекает неликвиды и шум). Сигналы пересчитываются из актуальных агрегаций (tickerAggs) при каждом новом событии. Сигналы старше 30 минут автоматически удаляются.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-warning)] uppercase tracking-wider">Как рассчитывается Signal Score (v2)</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      <b className="text-[var(--terminal-text)]">signalScore = concentration × persistence × (0.3 + 0.7 × volumeAnomaly) × algoConfirm × 100</b><br /><br />
                      <b className="text-[var(--terminal-warning)]">concentration</b> = |deltaNet| / totalLots (0-1) — насколько давление одностороннее. 1.0 = чисто в одну сторону. Аналог aggression из ТИКЕРЫ, но в контексте концентрации сигнала.<br />
                      <b className="text-[var(--terminal-warning)]">persistence</b> = min(events / 8, 1) — устойчивость программы. 8+ событий за 30 мин = 1.0. В v1 было /6, но для СИЛЬНОГО сигнала нужно больше подтверждений.<br />
                      <b className="text-[var(--terminal-warning)]">volumeAnomaly</b> = log(1 + avgLots / medianAvgLots) / log(11) (0-1) — аномалия объёма относительно медианы по всем тикерам. Если среднее событие тикера в 10x больше медианы = 1.0.<br /><br />
                      <b className="text-[var(--terminal-accent)]">algoConfirm — кросс-подтверждение из AlgoPack (НОВОЕ!):</b><br />
                      Это ключевое улучшение v2 — сигнал получает буст, если СТАКАН-СКАНЕР и/или ЛОКАТОР КРУПНЯКА подтверждают направление:<br />
                      <b className="text-[var(--terminal-muted)]">×1.0</b> — нет AlgoPack-подтверждения (базовый уровень)<br />
                      <b className="text-[var(--terminal-accent)]">×1.2</b> — СТАКАН-СКАНЕР подтверждает (BID-стена + LONG сигнал, или ASK-стена + SHORT сигнал)<br />
                      <b className="text-[var(--terminal-positive)]">×1.3</b> — ЛОКАТОР КРУПНЯКА подтверждает (accumulation LONG + LONG сигнал, или SHORT + SHORT)<br />
                      <b className="text-[var(--terminal-warning)]">×1.5</b> — оба фрейма подтверждают направление (максимальная надёжность!)<br /><br />
                      <b className="text-[var(--terminal-warning)]">Абсолютная шкала [0, 100]:</b> SCORE не зависит от текущего максимума на рынке. 90-100 = мощнейший сигнал, 50-89 = значимый, 25-49 = умеренный, менее 25 = слабый (не показывается). Раньше SCORE был в диапазоне [0, 1] — трейдеру было непонятно, 0.6 это много или мало. Теперь шкала совпадает с ЛОКАТОРОМ и СТАКАН-СКАНЕР.<br /><br />
                      <b className="text-[var(--terminal-warning)]">Фильтр качества:</b> сигналы с totalLots &lt; 5000 исключаются. GAZP с 18 лотами — это шум, не сигнал. Минимум 3 события — статистическая значимость.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">Значок ★ — AlgoPack-подтверждение</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Если рядом с тикером в списке сигналов виден <b className="text-[var(--terminal-accent)]">★</b> — это значит, что AlgoPack подтверждает направление сигнала. Чем больше подтверждений (СТАКАН + ЛОКАТОР), тем выше SCORE и надёжнее сигнал. Два фрейма (5 и 6) видят ту же картину с других ракурсов: стакан (лимитные заявки) и поток денег (маркет-ордера). Совпадение всех трёх перспектив = сильнейший подтверждающий сигнал.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-positive)] uppercase tracking-wider">Как использовать</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      <b className="text-[var(--terminal-text)]">1.</b> СИЛЬНЫЙ LONG + ★ = роботы агрессивно покупают, и AlgoPack подтверждает. Наивысшая надёжность — можно действовать.<br />
                      <b className="text-[var(--terminal-text)]">2.</b> СИЛЬНЫЙ LONG без ★ = роботы покупают, но AlgoPack молчит. Возможно, институции ещё не включились — сигнал менее надёжный.<br />
                      <b className="text-[var(--terminal-text)]">3.</b> СРЕДНИЕ сигналы — подтверждение тренда. Если несколько СРЕДНИХ одного направления = мульти-подтверждение.<br />
                      <b className="text-[var(--terminal-text)]">4.</b> Потенциальные — тикеры с 3 событиями, ещё не набравшие SCORE 25+. Наблюдение.<br />
                      <b className="text-[var(--terminal-text)]">5.</b> Комбинируйте с ТИКЕРЫ (Фрейм 1) для детализации: какой паттерн, какой тип робота, aggression/persistence.
                    </p>
                  </div>
                </div>
              </div>

              {/* Фрейм 5: СТАКАН-СКАНЕР */}
              <div className="border border-[var(--terminal-warning)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-warning)]/10 border-b border-[var(--terminal-warning)]/30">
                  <Shield className="w-4 h-4 text-[var(--terminal-warning)]" />
                  <span className="text-sm font-bold text-[var(--terminal-warning)]">Фрейм 5: СТАКАН-СКАНЕР — Стены стакана</span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">Что показывает</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Дисбалансы в стакане заявок по ЛИКВИДНЫМ тикерам Мосбиржи через MOEX AlgoPack (obstats). <b className="text-[var(--terminal-warning)]">Фильтр качества:</b> оборот от 50 млн руб, спред менее 50%, дисбаланс от 5%. Это отсекает неликвиды с мёртвым стаканом и единичными заявками. Сканирует структуру стакана — объёмы заявок на покупку/продажу, дисбаланс, спред, VWAP bid/ask. Ранжирует по wall_score на абсолютной шкале: 90-100 = мощнейшая стена, 50-89 = значимая, 20-49 = умеренная, менее 20 = слабая.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-warning)] uppercase tracking-wider">Как рассчитывается wall_score (v2)</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      <b className="text-[var(--terminal-text)]">wall_score = imbalanceStrength x bboProximity x volumeScale x (1 - spreadPenalty)</b><br /><br />
                      <b className="text-[var(--terminal-warning)]">imbalanceStrength = |imbalance_vol|</b> — сила дисбаланса объёма заявок (0-1). Показывает, насколько одна сторона стакана перевешивает другую. 0.5 = 50% объёма на одной стороне = сильная стена.<br />
                      <b className="text-[var(--terminal-warning)]">bboProximity = 0.3 + 0.7 x |imbalance_vol_bbo|</b> — близость стены к лучшей цене (0.3-1.0). Стена на BBO (Best Bid/Offer) = давит на цену прямо сейчас, получает максимальный вес. Глубокая стена тоже значима — базовый вес 0.3, она не обнуляется.<br />
                      <b className="text-[var(--terminal-warning)]">volumeScale = log(1 + valTotal / medianValTotal) / log(11)</b> — масштаб стен в рублях (0-1). Стена в 1 млрд руб у Газпрома значимее, чем стена в 5 млн у неликвида. Лог-шкала сжимает разницу между 100М и 10B.<br />
                      <b className="text-[var(--terminal-warning)]">spreadPenalty = min(spread_bbo / 50, 0.8)</b> — штраф за широкий спред (0-0.8). Спред 50%+ = мёртвый тикер, штраф 80%. Узкий спред = ликвидный рынок, штрафа нет.<br /><br />
                      <b className="text-[var(--terminal-warning)]">Абсолютная шкала (v2):</b> rawScore x 200, capped at 100. SCORE не зависит от текущего максимума на рынке. Если ни один тикер не набрал 50 — значит стен сейчас нет. Раньше нормализация к [0, 100] по максимуму создавала иллюзию: слабый дисбаланс на пустом рынке получал 80+.<br /><br />
                      <b className="text-[var(--terminal-warning)]">Почему v2?</b> В v1 формула зависела от imbalance_val (дисбаланс в рублях), но MOEX obstats возвращает это поле = 0 для всех тикеров. Из-за этого wall_score был 0 для всего рынка. Формула v2 не использует ненадёжные поля.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-positive)] uppercase tracking-wider">Теги ТИХО / СРОЧНО</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      <b className="text-[var(--terminal-positive)]">ТИХО</b> — стена расположена «глубоко» в стакане, |imbalance_vol_bbo| &lt; 0.3. Крупный игрок аккуратно выставляет лимитные заявки в глубине, не давя на цену прямо сейчас. Это может быть планомерное накопление или «заграждение» — уровень, который не даст цене уйти ниже.<br />
                      <b className="text-[var(--terminal-negative)]">СРОЧНО</b> — стена стоит прямо на лучшей цене, |imbalance_vol_bbo| &gt;= 0.3. Кто-то агрессивно защищает уровень или давит на цену прямо сейчас. Это более срочный и более значимый сигнал.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-positive)] uppercase tracking-wider">Как использовать трейдеру</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      <b className="text-[var(--terminal-text)]">1.</b> Используйте мини-табы <b className="text-[var(--terminal-accent)]">ЛИКВИД</b> / <b className="text-[var(--terminal-warning)]">НЕЛИКВИД</b> для переключения между категориями. Ликвидные — тикеры с оборотом 50М+ руб. Неликвидные — тикеры с оборотом 50М+ но не из TOP-100.<br />
                      <b className="text-[var(--terminal-text)]">2.</b> BID-стена (зелёная) = крупный покупатель стоит в стакане. Если wall_score высокий и тег СРОЧНО — покупатель давит на цену вверх. Если ТИХО — аккуратно набирает позицию, не толкая цену.<br />
                      <b className="text-[var(--terminal-text)]">3.</b> ASK-стена (красная) = крупный продавец. СРОЧНО — давит вниз, возможно блокирует рост. ТИХО — планомерно распродаёт.<br />
                      <b className="text-[var(--terminal-text)]">4.</b> Сопоставляйте СТАКАН-СКАНЕР с ЛОКАТОРОМ КРУПНЯКА: если стена в стакане совпадает с направлением накопления — это сильнейший подтверждающий сигнал.<br />
                      <b className="text-[var(--terminal-text)]">5.</b> Данные обновляются каждые 5 минут (частота AlgoPack). Абсолютная шкала: 100 = мощнейшая стена, менее 20 = слабая. Если все SCORE ниже 20 — стен на рынке сейчас нет.
                    </p>
                  </div>
                </div>
              </div>

              {/* Фрейм 6: ЛОКАТОР КРУПНЯКА */}
              <div className="border border-[var(--terminal-accent)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-accent)]/10 border-b border-[var(--terminal-accent)]/30">
                  <TrendingUp className="w-4 h-4 text-[var(--terminal-accent)]" />
                  <span className="text-sm font-bold text-[var(--terminal-accent)]">Фрейм 6: ЛОКАТОР КРУПНЯКА — Детектор институционального капитала</span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-accent)] uppercase tracking-wider">Что показывает</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Тикеры, где крупные участники (фонды, банки, системные алгоритмы) активно набирают или сбрасывают позицию. Работает по ЛИКВИДНЫМ тикерам Мосбиржи через MOEX AlgoPack (tradestats + orderstats). <b className="text-[var(--terminal-warning)]">Фильтр качества:</b> оборот от 50 млн руб за день + минимум 30 сделок за 5-минутное окно. Это отсекает неликвиды, где единичная сделка создаёт иллюзию «крупняка». Анализирует направленность потока денег, размер средней сделки, дисбаланс покупателей/продавцов, частоту отмены ордеров (спуфинг). Ранжирует по accumulation_score — композитному SCORE на абсолютной шкале (не относительной!), где 90-100 = мощнейший институциональный поток, 50-89 = значимый, 20-49 = умеренный, менее 20 = слабый.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-warning)] uppercase tracking-wider">Как рассчитывается accumulation_score</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      <b className="text-[var(--terminal-text)]">accumulation_score = |direction| x magnitude x liquidity_scarcity x (1 - spoof_penalty)</b><br /><br />
                      <b className="text-[var(--terminal-accent)]">direction = (val_b - val_s) / (val_b + val_s)</b> — направленность потока в диапазоне [-1, 1]. +1 = все деньги в покупках, -1 = все в продажах. Чем сильнее перекос, тем увереннее крупняк действует.<br />
                      <b className="text-[var(--terminal-accent)]">magnitude = log(1 + |val_b - val_s| / 100K)</b> — логарифмическая шкала абсолютной разницы покупок/продаж в рублях. Сжимает хвосты, чтобы Сбербанк с миллиардом оборота не всегда был на первом месте.<br />
                      <b className="text-[var(--terminal-accent)]">liquidity_scarcity = 1 / (1 + log10(val_today / median_val)²)</b> — квадратичная зависимость: максимальный множитель у медианных по ликвидности бумаг, снижение для сверхликвидов (где поток размывается) и неликвидов (отфильтрованы порогом 50 млн).<br />
                      <b className="text-[var(--terminal-accent)]">spoof_penalty = 0.5 x cancelRatio</b> — штраф за спуфинг. Если участник выставляет и отменяет ордера (cancelRatio &gt; 0.5), его SCORE снижается. Настоящее накопление не нуждается в отменах.<br /><br />
                      <b className="text-[var(--terminal-warning)]">Абсолютная шкала (v2):</b> rawScore x 20, capped at 100. Это значит что SCORE не зависит от текущего максимума на рынке. Если ни один тикер не набрал 100 — значит и мощного институционального потока сейчас нет. Раньше нормализация к [0, 100] по максимуму создавала иллюзию: слабый сигнал на пустом рынке получал 80+, потому что был «лучшим из худших».<br /><br />
                      <b className="text-[var(--terminal-warning)]">Фильтр качества:</b> тикеры с оборотом менее 50 млн руб или менее 30 сделок за 5-минутное окно полностью исключаются. На неликвидах 1-2 сделки создают иллюзию крупняка, но статистически это noise — средний размер сделки при 10 сделках не репрезентативен.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-positive)] uppercase tracking-wider">Теги ТИХО / СРОЧНО</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      <b className="text-[var(--terminal-positive)]">ТИХО</b> — тихое накопление. Направленность &gt; 5%, но умеренная (|direction| &lt; 0.15) или disb &lt; 0.5. Крупняк аккуратно набирает позицию через лимитные ордера, не привлекая внимания. Средний размер сделки может быть большим, но частота невысокая — «тихий» процесс. Это самый ценный сигнал: крупный игрок строит позицию, и когда набор закончится — цена двинет.<br />
                      <b className="text-[var(--terminal-negative)]">СРОЧНО</b> — агрессивный напор. |direction| &gt;= 0.15 и |disb| &gt; 0.5. Крупняк срочно покупает/продаёт через маркет-ордера, не считаясь с ценой. DISB (дисбаланс сделок) высокий — значит инициирует крупного участника, а не контрагент. Это более очевидный, но и более срочный сигнал — нужно действовать быстро.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-negative)] uppercase tracking-wider">Спуфинг (предупреждение)</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      Если cancelRatio &gt; 70% — тикер помечается как спуфинг (строка подсвечивается красным). Это значит, что участник выставляет крупные заявки и тут же отменяет их, создавая иллюзию давления. Настоящее накопление НЕ отменяет ордера — оно исполняется. Поэтому спуфинг-тикеры имеют заниженный accumulation_score, но всё равно показываются для информации. Торгуйте такие тикеры с осторожностью.
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-[var(--terminal-positive)] uppercase tracking-wider">Как использовать трейдеру</span>
                    <p className="text-[10px] text-[var(--terminal-neutral)] mt-1 leading-relaxed">
                      <b className="text-[var(--terminal-text)]">1.</b> Используйте мини-табы <b className="text-[var(--terminal-accent)]">ЛИКВИД</b> / <b className="text-[var(--terminal-warning)]">НЕЛИКВИД</b> для переключения между категориями. Неликвиды (оборот 50-100 млн) могут содержать сигналы, но оценивайте их осторожно — средняя сделка может быть всего из 30-50 сделок за окно.<br />
                      <b className="text-[var(--terminal-text)]">2.</b> ТИХО LONG + высокий SCORE = крупняк тихо набирает лонг-позицию. Идеальный вход: ещё не поздно присоединиться, цена ещё не ушла. Ставьте лимитный ордер чуть ниже текущей цены и ждите.<br />
                      <b className="text-[var(--terminal-text)]">3.</b> СРОЧНО LONG = крупняк срочно покупает. Цена, скорее всего, уже идёт вверх — можно заходить маркетом, но проскальзывание будет. Подтвердите направление через СТАКАН-СКАНЕР (BID-стена?).<br />
                      <b className="text-[var(--terminal-text)]">4.</b> ТИХО SHORT = крупняк тихо сбрасывает. Самый опасный сигнал — когда крупный игрок распродаёт без шума, цена может обвалиться в любой момент. Рассмотрите шорт или фиксацию лонга.<br />
                      <b className="text-[var(--terminal-text)]">5.</b> Сопоставляйте с СТАКАН-СКАНЕР: накопление LONG + BID-стена = мощное подтверждение. Накопление LONG + ASK-стена = борьба, крупняк покупает, но продавец сопротивляется.<br />
                      <b className="text-[var(--terminal-text)]">6.</b> Средний размер сделки (Ср.сд) показывает «калибр» участника. Если avgTradeSize в 5-10 раз выше типичного — это не ритейл, это фонд или банк.
                    </p>
                  </div>
                </div>
              </div>

              {/* Общий совет */}
              <div className="border border-[var(--terminal-border)] rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                  <Shield className="w-4 h-4 text-[var(--terminal-text)]" />
                  <span className="text-sm font-bold text-[var(--terminal-text)]">Советы по использованию RADAR</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-accent)] mt-0.5 shrink-0">1.</span>
                    <span className="text-[var(--terminal-neutral)]">Начинайте с ТИКЕРОВ — определите где концентрируется активность, затем перейдите к ДЛИТЕЛЬНОСТИ для анализа типов роботов и их профилей</span>
                  </div>
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-accent)] mt-0.5 shrink-0">2.</span>
                    <span className="text-[var(--terminal-neutral)]">ДИНАМИКА показывает тренд — если волна разворачивается, будьте готовы к смене направления</span>
                  </div>
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-accent)] mt-0.5 shrink-0">3.</span>
                    <span className="text-[var(--terminal-neutral)]">СИГНАЛЫ — самый быстрый способ найти точки входа: СИЛЬНЫЙ + ★ (AlgoPack-подтверждение) = наивысшая надёжность</span>
                  </div>
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-warning)] mt-0.5 shrink-0">4.</span>
                    <span className="text-[var(--terminal-neutral)]">СТАКАН-СКАНЕР + ЛОКАТОР КРУПНЯКА — комбо: если оба фрейма показывают один тикер с высоким SCORE — это сильнейший подтверждающий сигнал. Оба фрейма используют фильтр качества (50М+ оборот) и абсолютную шкалу</span>
                  </div>
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-accent)] mt-0.5 shrink-0">5.</span>
                    <span className="text-[var(--terminal-neutral)]">Нажмите <b className="text-[var(--terminal-text)]">?</b> на заголовке любого фрейма для быстрой подсказки прямо в радаре</span>
                  </div>
                  <div className="flex items-start gap-2 text-[10px]">
                    <span className="text-[var(--terminal-accent)] mt-0.5 shrink-0">6.</span>
                    <span className="text-[var(--terminal-neutral)]">Фреймы 1-4 обновляются при каждом обнаруженном событии (скользящее окно 30 мин). Фреймы 5-6 обновляются каждые 5 мин (AlgoPack). Все SCORE нормализованы: 100 = максимум на рынке. Метрики сохраняются в Redis каждые 30 сек (TTL 7 дней) — после F5 данные восстанавливаются. Система использует 3 уровня детекции: <b className="text-[var(--terminal-negative)]">HFT</b> (суб-секундные алгоритмы, окно 3 сек), <b className="text-[var(--terminal-accent)]">АЛГО</b> (алгоритмические стратегии, окно 2 мин), <b className="text-[var(--terminal-positive)]">СТРУКТУР</b> (крупные позиционные игроки, окно 30 мин)</span>
                  </div>
                </div>
              </div>
            </div>
          );
            return null;
          })()}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-[var(--terminal-border)] bg-[var(--terminal-surface)] flex items-center justify-between">
          <span className="text-[9px] text-[var(--terminal-muted)] font-mono">
            Клавиша: [F2] Справка
          </span>
          <button onClick={onClose} className="px-3 py-1 text-[10px] font-bold text-[var(--terminal-text)] bg-[var(--terminal-border)] hover:bg-[var(--terminal-border)] rounded transition-colors">
            Закрыть
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
