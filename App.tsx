
import React, { useState, useEffect, useMemo } from 'react';
import { PaymentMethod, DeviceType, OutPartyEntry, MainEntry, HistoryRecord, DailyRecord } from './types';
import { fetchExchangeRates } from './services/geminiService';

const App: React.FC = () => {
  // --- Initialization & Device Logic ---
  const [device, setDevice] = useState<DeviceType>(DeviceType.LAPTOP);
  const [isInitialized, setIsInitialized] = useState(false);
  const [syncId, setSyncId] = useState<string>('');
  
  // --- Data State ---
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [outPartyEntries, setOutPartyEntries] = useState<OutPartyEntry[]>([]);
  const [mainEntries, setMainEntries] = useState<MainEntry[]>([]);
  const [rates, setRates] = useState({ usd: 310, eur: 335 });
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [viewHistory, setViewHistory] = useState(false);

  // --- Effects ---

  useEffect(() => {
    // Determine device from URL hash
    const hash = window.location.hash.replace('#', '');
    if (Object.values(DeviceType).includes(hash as DeviceType)) {
      setDevice(hash as DeviceType);
    } else {
      // Auto-detect based on user agent or screen size if no hash
      if (/Android/i.test(navigator.userAgent)) setDevice(DeviceType.ANDROID);
      else if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) setDevice(DeviceType.IPHONE);
      else setDevice(DeviceType.LAPTOP);
    }

    // Load persistent data (Automatic Connection logic)
    const savedSyncId = localStorage.getItem('shivas_sync_id');
    if (savedSyncId) {
      setSyncId(savedSyncId);
      loadSyncedData();
    }
    
    setIsInitialized(true);

    // Rate update
    fetchExchangeRates().then(r => setRates(r));
  }, []);

  // Sync Logic: Listen for changes from other tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'shivas_data_sync') {
        loadSyncedData();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const loadSyncedData = () => {
    const data = localStorage.getItem('shivas_data_store');
    if (data) {
      const parsed = JSON.parse(data);
      setOutPartyEntries(parsed.outPartyEntries || []);
      setMainEntries(parsed.mainEntries || []);
      setHistory(parsed.history || []);
      setOpeningBalance(parsed.openingBalance || 0);
    }
  };

  const persistData = (updates: any) => {
    const currentData = {
      outPartyEntries,
      mainEntries,
      history,
      openingBalance,
      ...updates
    };
    localStorage.setItem('shivas_data_store', JSON.stringify(currentData));
    // Trigger storage event for other instances
    localStorage.setItem('shivas_data_sync', Date.now().toString());
  };

  // --- Calculations ---

  const totals = useMemo(() => {
    // 1. Out Party Totals
    const outCash = outPartyEntries.filter(e => e.method === PaymentMethod.CASH).reduce((s, e) => s + e.amount, 0);
    const outCard = outPartyEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + e.amount, 0);
    const outPaypal = outPartyEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + e.amount, 0);

    // 2. Main Totals (Direct entries)
    const mainDirectIn = mainEntries.reduce((s, e) => s + e.cashIn, 0);
    const mainDirectOut = mainEntries.reduce((s, e) => s + e.cashOut, 0);
    const mainCardIn = mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + e.cashIn, 0);
    const mainPaypalIn = mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + e.cashIn, 0);

    // Requirement 14 & 7: Main Card total = Main card entries + Out party card total
    const totalCard = mainCardIn + outCard;
    const totalPaypal = mainPaypalIn + outPaypal;

    // Requirement 13: Out party totals add to main section CASH IN
    // Also include opening balance in cash in
    const totalCashIn = openingBalance + mainDirectIn + outCash + outCard + outPaypal;

    // Requirement 15: All card totals and pay pal totals need to add also main section cash out total
    const totalCashOut = mainDirectOut + totalCard + totalPaypal;

    // Requirement 16: Final Balance
    const finalBalance = totalCashIn - totalCashOut;

    return {
      outCash, outCard, outPaypal,
      totalCard, totalPaypal,
      totalCashIn, totalCashOut, finalBalance
    };
  }, [outPartyEntries, mainEntries, openingBalance]);

  // --- Handlers (Laptop Only) ---

  const canEdit = device === DeviceType.LAPTOP;

  const addOutParty = (method: PaymentMethod, amount: number) => {
    if (!canEdit) return;
    const newEntries = [...outPartyEntries, {
      id: crypto.randomUUID(),
      index: outPartyEntries.length + 1,
      method,
      amount
    }];
    setOutPartyEntries(newEntries);
    persistData({ outPartyEntries: newEntries });
  };

  const removeOutParty = (id: string) => {
    if (!canEdit) return;
    const newEntries = outPartyEntries.filter(e => e.id !== id).map((e, idx) => ({ ...e, index: idx + 1 }));
    setOutPartyEntries(newEntries);
    persistData({ outPartyEntries: newEntries });
  };

  const addMainEntry = (roomNo: string, description: string, method: PaymentMethod, cashIn: number, cashOut: number) => {
    if (!canEdit) return;
    const newEntries = [...mainEntries, {
      id: crypto.randomUUID(),
      roomNo,
      description,
      method,
      cashIn,
      cashOut
    }];
    setMainEntries(newEntries);
    persistData({ mainEntries: newEntries });
  };

  const removeMainEntry = (id: string) => {
    if (!canEdit) return;
    const newEntries = mainEntries.filter(e => e.id !== id);
    setMainEntries(newEntries);
    persistData({ mainEntries: newEntries });
  };

  const handleDayEnd = () => {
    if (!canEdit) return;
    if (!confirm("Confirm Day End? This will clear all current entries.")) return;

    const newRecord: HistoryRecord = {
      date: new Date().toLocaleDateString(),
      finalBalance: totals.finalBalance,
      record: {
        date: new Date().toLocaleDateString(),
        openingBalance,
        outPartyEntries,
        mainEntries,
        rates
      }
    };

    const newHistory = [newRecord, ...history];
    const newOpeningBalance = totals.finalBalance;
    
    setHistory(newHistory);
    setOpeningBalance(newOpeningBalance);
    setOutPartyEntries([]);
    setMainEntries([]);

    persistData({
      history: newHistory,
      openingBalance: newOpeningBalance,
      outPartyEntries: [],
      mainEntries: []
    });
  };

  // --- UI Components ---

  if (!isInitialized) return null;

  // Requirement 4: Restrict Laptop access on mobile devices (Simulation)
  const isActuallyMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isActuallyMobile && device === DeviceType.LAPTOP) {
    return (
      <div className="h-screen flex items-center justify-center p-8 bg-red-50 text-center">
        <div className="max-w-md">
          <h2 className="text-2xl font-black text-red-600 mb-4">ACCESS DENIED</h2>
          <p className="font-bold text-gray-700">Laptop version is not allowed on mobile devices. Please use the Android or iPhone links.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#1e293b] font-medium selection:bg-blue-100">
      {/* Top Header - Requirement 9 & 12 */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-40 p-4 md:p-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-3xl md:text-4xl font-extrabold text-blue-900 tracking-tighter">SHIVAS BEACH CABANAS</h1>
            <p className="text-sm font-bold text-gray-400 mt-1 uppercase tracking-widest">{new Date().toDateString()}</p>
          </div>

          <div className="flex gap-4">
            <RateCard label="USD" value={rates.usd} />
            <RateCard label="EURO" value={rates.eur} />
            <div className="flex flex-col items-center justify-center px-4 py-2 bg-slate-100 rounded-xl border border-slate-200">
              <span className="text-[10px] font-black text-slate-500 uppercase">Device Mode</span>
              <span className={`text-xs font-black uppercase ${canEdit ? 'text-green-600' : 'text-orange-500'}`}>{device}</span>
            </div>
          </div>
        </div>
      </header>

      {!syncId ? (
        <SyncOverlay onConnect={(id) => {
          setSyncId(id);
          localStorage.setItem('shivas_sync_id', id);
        }} />
      ) : (
        <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
          
          <div className="flex justify-end gap-2">
             <button 
                onClick={() => setViewHistory(!viewHistory)}
                className="px-6 py-2 rounded-full bg-slate-800 text-white font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-md"
             >
                {viewHistory ? 'Close History' : 'View Past Days'}
             </button>
          </div>

          {viewHistory ? (
            <HistorySection history={history} />
          ) : (
            <>
              {/* Requirement 5: Out Party Section */}
              <section className="bg-white rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-700 to-blue-900 p-6 flex flex-col md:flex-row justify-between items-center gap-6">
                  <h2 className="text-xl font-black text-white uppercase tracking-widest">OUT PARTY SECTION</h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    <MiniStat label="CASH" value={totals.outCash} color="bg-blue-500" />
                    <MiniStat label="CARD" value={totals.outCard} color="bg-yellow-500" />
                    <MiniStat label="PAYPAL" value={totals.outPaypal} color="bg-purple-500" />
                  </div>
                </div>

                {canEdit && (
                  <div className="p-6 bg-blue-50/50 border-b border-blue-100">
                    <OutPartyForm onAdd={addOutParty} />
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b">
                      <tr>
                        <th className="px-6 py-4 w-16">#</th>
                        <th className="px-6 py-4">Method</th>
                        <th className="px-6 py-4 text-right">Amount (Rs)</th>
                        {canEdit && <th className="px-6 py-4 w-16 text-center">Action</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {outPartyEntries.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-colors group">
                          <td className="px-6 py-4 font-black text-slate-300 group-hover:text-blue-500">{e.index}</td>
                          <td className="px-6 py-4">
                            <MethodBadge method={e.method} />
                          </td>
                          <td className="px-6 py-4 text-right font-black text-lg text-slate-900">
                            {e.amount.toLocaleString()}
                          </td>
                          {canEdit && (
                            <td className="px-6 py-4 text-center">
                              <button onClick={() => removeOutParty(e.id)} className="text-red-300 hover:text-red-600 font-black text-xl leading-none">&times;</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Requirement 5: Main Section */}
              <section className="bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-900 p-8">
                  <div className="flex flex-col lg:flex-row justify-between items-center gap-8">
                    <h2 className="text-2xl font-black text-white uppercase tracking-[0.2em]">MAIN SECTION</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full lg:w-auto">
                      <MainStat label="CASH IN TOTAL" value={totals.totalCashIn} color="text-blue-400" border="border-blue-400/30" />
                      <MainStat label="CASH OUT TOTAL" value={totals.totalCashOut} color="text-red-400" border="border-red-400/30" />
                      <MainStat label="FINAL BALANCE" value={totals.finalBalance} color="text-green-400" border="border-green-400/30" highlight />
                      <div className="flex flex-col gap-2">
                         <div className="flex justify-between items-center bg-slate-800 px-3 py-1 rounded-lg">
                            <span className="text-[9px] font-black text-yellow-500">CARD TOTAL</span>
                            <span className="text-xs font-black text-white">Rs.{totals.totalCard.toLocaleString()}</span>
                         </div>
                         <div className="flex justify-between items-center bg-slate-800 px-3 py-1 rounded-lg">
                            <span className="text-[9px] font-black text-purple-500">PAYPAL TOTAL</span>
                            <span className="text-xs font-black text-white">Rs.{totals.totalPaypal.toLocaleString()}</span>
                         </div>
                      </div>
                    </div>
                  </div>
                </div>

                {canEdit && (
                  <div className="p-8 bg-slate-50 border-b">
                    <MainForm onAdd={addMainEntry} />
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left table-fixed min-w-[1000px]">
                    <thead className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b">
                      <tr>
                        <th className="px-8 py-6 w-24">ROOM</th>
                        <th className="px-8 py-6 w-2/5">DESCRIPTIONS</th>
                        <th className="px-8 py-6 w-32 text-center">METHOD</th>
                        <th className="px-8 py-6 w-40 text-right">CASH IN (Rs)</th>
                        <th className="px-8 py-6 w-40 text-right">CASH OUT (Rs)</th>
                        {canEdit && <th className="px-8 py-6 w-16 text-center">DEL</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {/* Opening Balance Row */}
                      {openingBalance !== 0 && (
                        <tr className="bg-green-50/50">
                          <td className="px-8 py-6 font-black text-green-700">OPEN</td>
                          <td className="px-8 py-6 font-bold text-green-800">CARRY FORWARD BALANCE FROM PREVIOUS DAY</td>
                          <td className="px-8 py-6 text-center"><MethodBadge method={PaymentMethod.CASH} /></td>
                          <td className="px-8 py-6 text-right font-black text-green-600">{openingBalance.toLocaleString()}</td>
                          <td className="px-8 py-6 text-right font-black text-slate-300">-</td>
                          {canEdit && <td className="px-8 py-6"></td>}
                        </tr>
                      )}
                      
                      {/* Out Party Summaries as Virtual Rows for Clarity if needed? 
                          Requirements say add them, showing them visually helps reconciliation */}
                      <tr className="bg-blue-50/30 italic">
                         <td className="px-8 py-4 font-black text-blue-400">OP</td>
                         <td className="px-8 py-4 font-bold text-blue-800">TOTAL OUT PARTY COLLECTIONS (CASH+CARD+PAYPAL)</td>
                         <td className="px-8 py-4 text-center">-</td>
                         <td className="px-8 py-4 text-right font-black text-blue-600">{(totals.outCash + totals.outCard + totals.outPaypal).toLocaleString()}</td>
                         <td className="px-8 py-4 text-right">-</td>
                         {canEdit && <td className="px-8 py-4"></td>}
                      </tr>

                      {mainEntries.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-all">
                          <td className="px-8 py-6 font-black text-slate-900">{e.roomNo || '--'}</td>
                          <td className="px-8 py-6 font-bold text-slate-800 leading-tight">{e.description}</td>
                          <td className="px-8 py-6 text-center">
                            <MethodBadge method={e.method} />
                          </td>
                          <td className="px-8 py-6 text-right font-black text-blue-600 text-lg">
                            {e.cashIn > 0 ? e.cashIn.toLocaleString() : '-'}
                          </td>
                          <td className="px-8 py-6 text-right font-black text-red-600 text-lg">
                            {e.cashOut > 0 ? e.cashOut.toLocaleString() : '-'}
                          </td>
                          {canEdit && (
                            <td className="px-8 py-6 text-center">
                              <button onClick={() => removeMainEntry(e.id)} className="text-red-300 hover:text-red-600 font-black text-xl">&times;</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Day End Button - Requirement 21 */}
              {canEdit && (
                <div className="flex justify-center pt-8">
                  <button 
                    onClick={handleDayEnd}
                    className="group relative inline-flex items-center justify-center px-16 py-6 font-black text-white bg-red-600 rounded-[2rem] overflow-hidden shadow-2xl hover:bg-red-700 active:scale-95 transition-all uppercase tracking-[0.3em]"
                  >
                    <span className="relative z-10">DAY END (CLOSE BOOK)</span>
                    <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      )}

      {/* Connection Indicator */}
      <div className="fixed bottom-6 left-6 z-50">
        <div className="bg-white px-4 py-2 rounded-full border border-slate-200 shadow-xl flex items-center gap-3">
          <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Live Sync Active</span>
        </div>
      </div>
    </div>
  );
};

// --- Sub-components ---

const RateCard = ({ label, value }: { label: string, value: number }) => (
  <div className="flex flex-col items-center bg-white border border-slate-100 px-5 py-3 rounded-2xl shadow-sm min-w-[100px]">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label} / LKR</span>
    <span className="text-lg font-black text-blue-900">Rs. {value}</span>
  </div>
);

const MiniStat = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className={`${color} px-4 py-2 rounded-xl text-white shadow-lg min-w-[120px] text-center`}>
    <p className="text-[9px] font-black opacity-80 uppercase leading-none mb-1">{label} TOTAL</p>
    <p className="text-sm font-black">Rs. {value.toLocaleString()}</p>
  </div>
);

const MainStat = ({ label, value, color, border, highlight = false }: { label: string, value: number, color: string, border: string, highlight?: boolean }) => (
  <div className={`${border} border-2 px-4 py-3 rounded-2xl bg-white/5 flex flex-col items-center justify-center ${highlight ? 'ring-4 ring-green-500/20 bg-green-950/20 border-green-500/50' : ''}`}>
    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</span>
    <span className={`text-xl font-black ${color}`}>Rs. {value.toLocaleString()}</span>
  </div>
);

const MethodBadge = ({ method }: { method: PaymentMethod }) => {
  const colors = {
    [PaymentMethod.CASH]: "bg-blue-100 text-blue-700 border-blue-200",
    [PaymentMethod.CARD]: "bg-yellow-100 text-yellow-800 border-yellow-400",
    [PaymentMethod.PAYPAL]: "bg-purple-100 text-purple-700 border-purple-200",
  };
  return (
    <span className={`${colors[method]} border px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter`}>
      {method}
    </span>
  );
};

const OutPartyForm = ({ onAdd }: { onAdd: (m: PaymentMethod, a: number) => void }) => {
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [amount, setAmount] = useState('');

  return (
    <form className="flex flex-wrap items-end gap-6" onSubmit={(e) => { e.preventDefault(); if (amount) onAdd(method, parseFloat(amount)); setAmount(''); }}>
      <div className="flex-1 min-w-[180px]">
        <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">Entry Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-black text-sm outline-none focus:ring-4 focus:ring-blue-500/10 transition-all">
          <option value={PaymentMethod.CASH}>CASH</option>
          <option value={PaymentMethod.CARD}>CARD</option>
          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="flex-[2] min-w-[240px]">
        <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">Amount (Rs.)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-black text-lg outline-none focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="0" />
      </div>
      <button type="submit" className="px-10 py-4 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 shadow-lg shadow-blue-500/20 uppercase text-xs tracking-[0.2em] transition-all">Add Out Entry</button>
    </form>
  );
};

const MainForm = ({ onAdd }: { onAdd: (r: string, d: string, m: PaymentMethod, ci: number, co: number) => void }) => {
  const [room, setRoom] = useState('');
  const [desc, setDesc] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [cashIn, setCashIn] = useState('');
  const [cashOut, setCashOut] = useState('');

  return (
    <form className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end" onSubmit={(e) => { e.preventDefault(); onAdd(room, desc, method, parseFloat(cashIn || '0'), parseFloat(cashOut || '0')); setRoom(''); setDesc(''); setCashIn(''); setCashOut(''); }}>
      <div className="md:col-span-1">
        <label className="block text-[9px] font-black text-slate-400 mb-2 uppercase">Room</label>
        <input type="text" value={room} onChange={(e) => setRoom(e.target.value)} className="w-full border p-4 rounded-2xl font-black text-center" placeholder="#" />
      </div>
      <div className="md:col-span-4">
        <label className="block text-[9px] font-black text-slate-400 mb-2 uppercase">Descriptions</label>
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full border p-4 rounded-2xl font-bold" placeholder="Guest name, service details..." required />
      </div>
      <div className="md:col-span-2">
        <label className="block text-[9px] font-black text-slate-400 mb-2 uppercase">Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full border p-4 rounded-2xl font-black">
          <option value={PaymentMethod.CASH}>CASH</option>
          <option value={PaymentMethod.CARD}>CARD</option>
          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="block text-[9px] font-black text-slate-400 mb-2 uppercase">Cash In (Rs)</label>
        <input type="number" value={cashIn} onChange={(e) => setCashIn(e.target.value)} className="w-full border p-4 rounded-2xl font-black text-blue-600" placeholder="0" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-[9px] font-black text-slate-400 mb-2 uppercase">Cash Out (Rs)</label>
        <input type="number" value={cashOut} onChange={(e) => setCashOut(e.target.value)} className="w-full border p-4 rounded-2xl font-black text-red-600" placeholder="0" />
      </div>
      <div className="md:col-span-1">
        <button type="submit" className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs hover:bg-black uppercase">Add</button>
      </div>
    </form>
  );
};

const SyncOverlay = ({ onConnect }: { onConnect: (id: string) => void }) => {
  const [val, setVal] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
      <div className="bg-white p-8 md:p-12 rounded-[3rem] shadow-2xl max-w-lg w-full text-center space-y-8">
        <div>
          <h2 className="text-3xl font-black text-blue-900 tracking-tighter mb-2">DEVICE PAIRING</h2>
          <p className="text-slate-500 font-bold">Connect your laptop and mobile devices automatically.</p>
        </div>
        <div className="space-y-4">
          <input 
            type="text" 
            value={val} 
            onChange={(e) => setVal(e.target.value)}
            className="w-full p-6 bg-slate-100 rounded-3xl border-2 border-slate-200 font-black text-2xl text-center outline-none focus:border-blue-500 transition-all uppercase"
            placeholder="ENTER YOUR ID"
          />
          <button 
            onClick={() => val && onConnect(val)}
            className="w-full p-6 bg-blue-600 text-white font-black rounded-3xl text-lg hover:bg-blue-700 shadow-xl shadow-blue-500/20 active:scale-95 transition-all uppercase tracking-widest"
          >
            Start Syncing
          </button>
        </div>
        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Requirement 3: Reconnection is automatic after first pairing</p>
      </div>
    </div>
  );
};

const HistorySection = ({ history }: { history: HistoryRecord[] }) => (
  <div className="space-y-6">
    <h2 className="text-3xl font-black text-slate-900 uppercase tracking-widest border-l-8 border-slate-900 pl-6">Archives</h2>
    <div className="grid gap-6">
      {history.map((h, i) => (
        <div key={i} className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="text-center md:text-left">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Date</p>
             <p className="text-2xl font-black text-slate-900">{h.date}</p>
          </div>
          <div className="flex gap-8">
            <div className="text-center">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Final Balance</p>
               <p className="text-2xl font-black text-green-600">Rs. {h.finalBalance.toLocaleString()}</p>
            </div>
          </div>
          <button className="px-8 py-3 bg-slate-100 text-slate-600 font-black rounded-xl hover:bg-slate-200 transition-all uppercase text-[10px] tracking-widest">Full Day Report</button>
        </div>
      ))}
    </div>
  </div>
);

export default App;
