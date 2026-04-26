import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';

export default function CalendarView({ workOrders, items, compact = false }: any) {
  const { t } = useLanguage();
  const [currentDate, setCurrentDate] = useState(new Date());
  const { uiStyle: currentStyle } = useTheme();
  const classic = currentStyle === 'classic';

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => setCurrentDate(new Date());

  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;

  // Bootstrap status classes (modern mode)
  const getStatusColor = (status: string) => {
      switch(status) {
          case 'COMPLETED': return 'bg-success text-white';
          case 'IN_PROGRESS': return 'bg-warning text-dark';
          case 'CANCELLED': return 'bg-danger text-white';
          default: return 'bg-primary text-white';
      }
  };

  // XP status colors (classic mode)
  const getXPStatusStyle = (status: string): React.CSSProperties => {
      switch(status) {
          case 'COMPLETED':   return { background: '#e8f5e9', border: '1px solid #2e7d32', color: '#1b4620' };
          case 'IN_PROGRESS': return { background: '#fff8e1', border: '1px solid #c77800', color: '#4a3000' };
          case 'CANCELLED':   return { background: '#fce4ec', border: '1px solid #b71c1c', color: '#6b0000' };
          default:            return { background: '#dde8f5', border: '1px solid #316ac5', color: '#00006e' };
      }
  };

  // XP dot colors for compact mode
  const getXPDotColor = (status: string) => {
      switch(status) {
          case 'COMPLETED':   return '#2e7d32';
          case 'IN_PROGRESS': return '#c77800';
          case 'CANCELLED':   return '#b71c1c';
          default:            return '#316ac5';
      }
  };

  // ── XP nav button style ──────────────────────────────────────────────────
  const xpNavBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '10px',
      padding: '1px 6px',
      cursor: 'pointer',
      background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
      border: '1px solid',
      borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
      color: '#000000',
      borderRadius: 0,
      ...extra,
  });

  // ── Build grid days ───────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split('T')[0];
  const days = [];

  // Empty leading cells
  for (let i = 0; i < firstDay; i++) {
      if (classic) {
          days.push(
              <div
                  key={`empty-${i}`}
                  style={{
                      background: '#f0ede6',
                      border: '1px solid #c0bdb5',
                      minHeight: compact ? 34 : 100,
                      opacity: 0.5,
                  }}
              ></div>
          );
      } else {
          days.push(
              <div key={`empty-${i}`} className={`calendar-day empty bg-light border opacity-25 ${compact ? 'py-1' : ''}`}></div>
          );
      }
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = todayStr === dateStr;

      const dayWOs = workOrders.filter((wo: any) => {
          if (!wo.due_date) return false;
          return wo.due_date.startsWith(dateStr);
      });

      if (classic) {
          days.push(
              <div
                  key={day}
                  style={{
                      background: isToday ? '#dde8f5' : '#ffffff',
                      border: isToday ? '1px solid #316ac5' : '1px solid #c0bdb5',
                      minHeight: compact ? 34 : 100,
                      padding: compact ? '2px 3px' : '4px 5px',
                  }}
              >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: compact ? 2 : 3 }}>
                      <span style={{
                          fontFamily: 'Tahoma, Arial, sans-serif',
                          fontSize: compact ? '9px' : '10px',
                          fontWeight: 'bold',
                          color: isToday ? '#0058e6' : '#333',
                      }}>{day}</span>
                      {!compact && dayWOs.length > 0 && (
                          <span style={{
                              background: '#e8e8e8',
                              border: '1px solid #6a6a6a',
                              color: '#333',
                              padding: '0 4px',
                              fontSize: '8px',
                              fontFamily: 'Tahoma, Arial, sans-serif',
                              fontWeight: 'bold',
                          }}>{dayWOs.length} Due</span>
                      )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', gap: 2, overflow: 'hidden' }}>
                      {compact ? (
                          dayWOs.slice(0, 3).map((wo: any) => (
                              <div
                                  key={wo.id}
                                  title={wo.code}
                                  style={{
                                      width: 5,
                                      height: 5,
                                      background: getXPDotColor(wo.status),
                                      border: '1px solid rgba(0,0,0,0.2)',
                                  }}
                              ></div>
                          ))
                      ) : (
                          dayWOs.map((wo: any) => (
                              <div
                                  key={wo.id}
                                  title={`${wo.code}: ${getItemName(wo.item_id)}`}
                                  style={{
                                      ...getXPStatusStyle(wo.status),
                                      padding: '1px 4px',
                                      fontFamily: 'Tahoma, Arial, sans-serif',
                                      fontSize: '9px',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap' as const,
                                  }}
                              >
                                  <div style={{ fontWeight: 'bold', fontSize: '8px', lineHeight: 1.2 }}>{wo.code}</div>
                                  <div style={{ fontSize: '9px', lineHeight: 1.2 }}>{getItemName(wo.item_id)}</div>
                              </div>
                          ))
                      )}
                      {compact && dayWOs.length > 3 && (
                          <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '8px', color: '#666' }}>+</span>
                      )}
                  </div>
              </div>
          );
      } else {
          days.push(
              <div key={day} className={`calendar-day border p-1 ${isToday ? 'bg-primary bg-opacity-10 border-primary' : 'bg-white'}`} style={{minHeight: compact ? '40px' : '120px'}}>
                  <div className="d-flex justify-content-between align-items-center mb-1">
                      <span className={`fw-bold ${compact ? 'extra-small' : 'small'} ${isToday ? 'text-primary' : 'text-muted'}`} style={{fontSize: compact ? '0.6rem' : 'inherit'}}>{day}</span>
                      {!compact && dayWOs.length > 0 && <span className="badge bg-secondary text-white" style={{fontSize: '0.6rem'}}>{dayWOs.length} Due</span>}
                  </div>
                  <div className={`d-flex ${compact ? 'flex-row justify-content-center' : 'flex-column'} gap-1 overflow-hidden`}>
                      {compact ? (
                          dayWOs.slice(0, 3).map((wo: any) => (
                              <div key={wo.id} className={`${getStatusColor(wo.status).split(' ')[0]} rounded-circle`} style={{width: '4px', height: '4px'}} title={wo.code}></div>
                          ))
                      ) : (
                          dayWOs.map((wo: any) => (
                              <div key={wo.id} className={`badge ${getStatusColor(wo.status)} text-start fw-normal text-truncate w-100 p-1`} title={`${wo.code}: ${getItemName(wo.item_id)}`}>
                                  <div style={{fontSize: '0.65rem', lineHeight: '1.1'}}>{wo.code}</div>
                                  <div style={{fontSize: '0.7rem'}}>{getItemName(wo.item_id)}</div>
                              </div>
                          ))
                      )}
                      {compact && dayWOs.length > 3 && <div className="text-muted" style={{fontSize: '0.5rem'}}>+</div>}
                  </div>
              </div>
          );
      }
  }

  // ── Classic render ────────────────────────────────────────────────────────
  if (classic) {
      const xpBevel: React.CSSProperties = {
          border: '2px solid',
          borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
          boxShadow: '2px 2px 4px rgba(0,0,0,0.3)',
          background: '#ece9d8',
          borderRadius: 0,
      };

      return (
          <div className={`fade-in ${compact ? 'compact-calendar' : ''}`}>
              {/* Navigation bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }} className="no-print">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button style={xpNavBtn()} onClick={prevMonth}>
                          <i className="bi bi-chevron-left"></i>
                      </button>
                      {!compact && (
                          <button style={xpNavBtn({ padding: '1px 8px' })} onClick={goToToday}>Today</button>
                      )}
                      <button style={xpNavBtn()} onClick={nextMonth}>
                          <i className="bi bi-chevron-right"></i>
                      </button>
                      <span style={{
                          fontFamily: 'Tahoma, Arial, sans-serif',
                          fontSize: compact ? '11px' : '12px',
                          fontWeight: 'bold',
                          color: '#0058e6',
                          marginLeft: 4,
                      }}>
                          {currentDate.toLocaleDateString(undefined, { month: compact ? 'short' : 'long', year: 'numeric' })}
                      </span>
                  </div>
              </div>

              {/* Calendar panel */}
              <div style={xpBevel}>
                  {/* Day-of-week header */}
                  <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(7, 1fr)',
                      background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
                      borderBottom: '2px solid #808080',
                  }}>
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                          <div key={i} style={{
                              textAlign: 'center',
                              padding: compact ? '2px 0' : '3px 0',
                              fontFamily: 'Tahoma, Arial, sans-serif',
                              fontSize: '10px',
                              fontWeight: 'bold',
                              color: '#000',
                              borderRight: i < 6 ? '1px solid #b0aaa0' : 'none',
                          }}>{d}</div>
                      ))}
                  </div>
                  {/* Grid */}
                  <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(7, 1fr)',
                      backgroundColor: '#808080',
                      gap: '1px',
                  }}>
                      {days}
                  </div>
              </div>
          </div>
      );
  }

  // ── Modern render ─────────────────────────────────────────────────────────
  return (
      <div className={`fade-in ${compact ? 'compact-calendar' : ''}`}>
          <div className="d-flex justify-content-between align-items-center mb-2 no-print">
              <div className="d-flex align-items-center gap-2">
                  <div className="btn-group">
                      <button className="btn btn-xs btn-light border p-1" style={{fontSize: '0.6rem'}} onClick={prevMonth}><i className="bi bi-chevron-left"></i></button>
                      {compact ? null : <button className="btn btn-sm btn-light border" onClick={goToToday}>Today</button>}
                      <button className="btn btn-xs btn-light border p-1" style={{fontSize: '0.6rem'}} onClick={nextMonth}><i className="bi bi-chevron-right"></i></button>
                  </div>
                  <span className={`fw-bold text-primary ${compact ? 'small' : ''}`}>
                      {currentDate.toLocaleDateString(undefined, { month: compact ? 'short' : 'long', year: 'numeric' })}
                  </span>
              </div>
          </div>
          <div className="card border-0 shadow-sm overflow-hidden">
              <div className="card-body p-0">
                  <div className="d-grid text-center bg-light border-bottom" style={{gridTemplateColumns: 'repeat(7, 1fr)'}}>
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => (
                          <div key={d} className="py-1 fw-bold text-muted" style={{fontSize: '0.6rem'}}>{d}</div>
                      ))}
                  </div>
                  <div className="d-grid" style={{gridTemplateColumns: 'repeat(7, 1fr)', backgroundColor: '#e5e7eb', gap: '1px'}}>
                      {days}
                  </div>
              </div>
          </div>
      </div>
  );
}
