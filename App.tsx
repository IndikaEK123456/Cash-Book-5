
import React, { useState, useEffect, useMemo, useRef } from 'react';
import Gun from 'gun';
import { PaymentMethod, DeviceType, OutPartyEntry, MainEntry, HistoryRecord } from './types';
import { fetchExchangeRates } from './services/geminiService';

// Initialize Gun with public relay peers for cross-device sync
const gun = Gun(['https://gun-manhattan.herokuapp.com/gun', 'https://relay.peer.ooo/gun']);

const App: React.FC = () => {
  // --- Device & Identity ---
  const [device, setDevice] = useState<DeviceType>(DeviceType.LAPTOP);
  const [syncId, setSyncId] = useState<string>(localStorage.getItem('shivas_sync_id') || '');
  const [isInitialized, setIsInitialized] = useState(false);

  // --- Core State ---
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [outPartyEntries, setOutPartyEntries] = useState<OutPartyEntry[]>([]);
  const [mainEntries, setMainEntries] = useState<MainEntry[]>([]);
  const [rates, setRates] = useState({ usd: 310, eur: 335 });
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [viewHistory, setViewHistory] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'connecting' | 'synced'>('connecting');

  // --- Effects ---

  useEffect(() => {
    // 1. Device detection
    const hash = window.location.hash.replace('#', '');
    if (Object.values(DeviceType).includes(hash as DeviceType)) {
      setDevice(hash as DeviceType);
    } else {
      const ua = navigator.userAgent;
      if (/Android/i.test(ua)) setDevice(DeviceType.ANDROID);
      else if (/iPhone|iPad|iPod/i.test(ua)) setDevice(DeviceType.IPHONE);
      else setDevice(DeviceType.LAPTOP);
    }

    // 2. Fetch Rates
    fetchExchangeRates().then(setRates);
    setIsInitialized(true);
  }, []);

  // --- GunJS Live Sync Logic ---
  useEffect(() => {
    if (!syncId) return;

    const db = gun.get('shivas_beach_cabanas').get(syncId);

    // Listen for data changes from ANY device
    db.on((data) => {
      if (!data) return;
      try {
        if (data.outParty) setOutPartyEntries(JSON.parse(data.outParty));
        if (data.main) setMainEntries(JSON.parse(data.main));
        if (data.history) setHistory(JSON.parse(data.history));
        if (data.openingBalance !== undefined) setOpeningBalance(data.openingBalance);
        setSyncStatus('synced');
      } catch (e) {
        console.error("Sync parsing error", e);
      }
    });

    return () => { db.off(); };
  }, [syncId]);

  const persist = (updates: any) => {
    if (!syncId) return;
    const db = gun.get('shivas_beach_cabanas').get(syncId);
    
    const payload: any = {};
    if (updates.outPartyEntries) payload.outParty = JSON.stringify(updates.outPartyEntries);
    if (updates.mainEntries) payload.main = JSON.stringify(updates.mainEntries);
    if (updates.history) payload.history = JSON.stringify(updates.history);
    if (updates.openingBalance !== undefined) payload.openingBalance = updates.openingBalance;

    db.put(payload);
  };

  // --- Calculations (Requirements 13-17) ---

  const totals = useMemo(() => {
    const opCash = outPartyEntries.filter(e => e.method === PaymentMethod.CASH).reduce((s, e) => s + (e.amount || 0), 0);
    const opCard = outPartyEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.amount || 0), 0);
    const opPaypal = outPartyEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.amount || 0), 0);

    const mainDirectIn = mainEntries.reduce((s, e) => s + (e.cashIn || 0), 0);
    const mainDirectOut = mainEntries.reduce((s, e) => s + (e.cashOut || 0), 0);
    
    const mainCardIn = mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.cashIn || 0), 0);
    const mainPaypalIn = mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.cashIn || 0), 0);

    // Requirement 14: Main section card total = Main section card in + Out party card total
    const totalCard = mainCardIn + opCard;
    // Requirement 14: Main section paypal total = Main section paypal in + Out party paypal total
    const totalPaypal = mainPaypalIn + opPaypal;

    // Requirement 13: All Out Party methods (Cash, Card, PayPal) add to Main CASH IN
    const totalCashIn = openingBalance + mainDirectIn + opCash + opCard + opPaypal;

    // Requirement 15: All card/paypal totals add to Main CASH OUT
    const totalCashOut = mainDirectOut + totalCard + totalPaypal;

    return {
      opCash, opCard, opPaypal,
      totalCard, totalPaypal,
      totalCashIn, totalCashOut,
      balance: totalCashIn - totalCashOut
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
    persist({ outPartyEntries: newEntries });
  };

  const removeOutParty = (id: string) => {
    if (!canEdit) return;
    const newEntries = outPartyEntries.filter(e => e.id !== id).map((e, idx) => ({ ...e, index: idx + 1 }));
    setOutPartyEntries(newEntries);
    persist({ outPartyEntries: newEntries });
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
    persist({ mainEntries: newEntries });
  };

  const removeMainEntry = (id: string) => {
    if (!canEdit) return;
    const newEntries = mainEntries.filter(e => e.id !== id);
    setMainEntries(newEntries);
    persist({ mainEntries: newEntries });
  };

  const handleDayEnd = () => {
    if (!canEdit) return;
    if (!confirm("Confirm Day End? This will clear today's book.")) return;

    const newRecord: HistoryRecord = {
      date: new Date().toLocaleDateString(),
      finalBalance: totals.balance,
      record: {
        date: new Date().toLocaleDateString(),
        openingBalance,
        outPartyEntries,
        mainEntries,
        rates
      }
    };

    const newHistory = [newRecord, ...history];
    const newOpening = totals.balance;

    setHistory(newHistory);
    setOpeningBalance(newOpening);
    setOutPartyEntries([]);
    setMainEntries([]);

    persist({
      history: newHistory,
      openingBalance: newOpening,
      outPartyEntries: [],
      mainEntries: []
    });
  };

  // --- UI Blockers ---
  if (!isInitialized) return null;

  const isActuallyMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isActuallyMobile && device === DeviceType.LAPTOP) {
    return (
      <div className="h-screen flex items-center justify-center p-8 bg-slate-900 text-center text-white">
        <div className="max-w-md space-y-6">
          <h2 className="text-4xl font-black text-red-500 tracking-tighter">RESTRICTED</h2>
          <p className="font-bold text-slate-400">Laptop version is disabled on mobile devices. Use the Viewer links provided.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-medium">
      {/* Requirement 9: Top View */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-40 p-5 md:p-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-4xl font-extrabold text-blue-900 tracking-tight leading-none">SHIVAS BEACH CABANAS</h1>
            <div className="flex items-center justify-center md:justify-start gap-3 mt-3">
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-3 py-1 rounded-full">{new Date().toDateString()}</span>
              <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase ${canEdit ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                {device} mode
              </span>
            </div>
          </div>

          <div className="flex gap-6">
            <RateBox label="USD" value={rates.usd} color="text-emerald-600" />
            <RateBox label="EURO" value={rates.eur} color="text-indigo-600" />
          </div>
        </div>
      </header>

      {!syncId ? (
        <PairingScreen onPair={(id) => {
          setSyncId(id);
          localStorage.setItem('shivas_sync_id', id);
        }} />
      ) : (
        <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-12 pb-32">
          
          <div className="flex justify-between items-center">
             <div className="flex items-center gap-3 bg-white px-5 py-2.5 rounded-full border shadow-sm">
                <div className={`w-3 h-3 rounded-full ${syncStatus === 'synced' ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-yellow-400 animate-pulse'}`}></div>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  {syncStatus === 'synced' ? `LIVE SYNC: ${syncId}` : 'CONNECTING...'}
                </span>
             </div>
             <button 
                onClick={() => setViewHistory(!viewHistory)}
                className="px-8 py-3 rounded-full bg-slate-900 text-white font-black text-xs uppercase tracking-[0.2em] hover:scale-105 transition-all shadow-lg active:scale-95"
             >
                {viewHistory ? 'Close History' : 'Archives'}
             </button>
          </div>

          {viewHistory ? (
            <HistoryView history={history} />
          ) : (
            <div className="space-y-12">
              {/* Out Party Section */}
              <section className="bg-white rounded-[3rem] shadow-2xl border border-slate-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-700 to-indigo-800 p-10 flex flex-col md:flex-row justify-between items-center gap-8">
                  <h2 className="text-2xl font-black text-white uppercase tracking-[0.3em]">OUT PARTY SECTION</h2>
                  <div className="flex flex-wrap justify-center gap-5">
                    <StatPill label="CASH" value={totals.opCash} color="bg-blue-500" />
                    <StatPill label="CARD" value={totals.opCard} color="bg-amber-500" />
                    <StatPill label="PAYPAL" value={totals.opPaypal} color="bg-purple-600" />
                  </div>
                </div>

                {canEdit && (
                  <div className="p-10 bg-blue-50/40 border-b border-blue-100">
                    <OutPartyForm onAdd={addOutParty} />
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b bg-slate-50/50">
                      <tr>
                        <th className="px-10 py-6 w-24">#</th>
                        <th className="px-10 py-6">Method</th>
                        <th className="px-10 py-6 text-right">Amount (Rs)</th>
                        {canEdit && <th className="px-10 py-6 w-24 text-center">Del</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {outPartyEntries.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-colors highlight-entry">
                          <td className="px-10 py-6 font-black text-slate-300">{e.index}</td>
                          <td className="px-10 py-6">
                            <MethodBadge method={e.method} />
                          </td>
                          <td className="px-10 py-6 text-right font-black text-2xl text-slate-900">
                            Rs. {e.amount.toLocaleString()}
                          </td>
                          {canEdit && (
                            <td className="px-10 py-6 text-center">
                              <button onClick={() => removeOutParty(e.id)} className="text-red-300 hover:text-red-600 font-black text-3xl leading-none">&times;</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {outPartyEntries.length === 0 && <div className="p-12 text-center text-slate-300 font-bold italic tracking-widest">NO OUT PARTY RECORDS</div>}
                </div>
              </section>

              {/* Main Section */}
              <section className="bg-white rounded-[3rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] border border-slate-200 overflow-hidden">
                <div className="bg-slate-900 p-12">
                  <div className="flex flex-col lg:flex-row justify-between items-center gap-10">
                    <h2 className="text-3xl font-black text-white uppercase tracking-[0.4em]">MAIN BOOK</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-8 w-full lg:w-auto">
                      <SummaryStat label="CASH IN" value={totals.totalCashIn} color="text-blue-400" border="border-blue-400/20" />
                      <SummaryStat label="CASH OUT" value={totals.totalCashOut} color="text-red-400" border="border-red-400/20" />
                      <SummaryStat label="FINAL BALANCE" value={totals.balance} color="text-green-400" border="border-green-400/20" highlight />
                      <div className="space-y-3">
                         <div className="flex justify-between items-center bg-slate-800/40 p-4 rounded-2xl border border-amber-500/20">
                            <span className="text-[10px] font-black text-amber-500 tracking-widest">CARD</span>
                            <span className="text-lg font-black text-white">Rs.{totals.totalCard.toLocaleString()}</span>
                         </div>
                         <div className="flex justify-between items-center bg-slate-800/40 p-4 rounded-2xl border border-purple-500/20">
                            <span className="text-[10px] font-black text-purple-500 tracking-widest">PAYPAL</span>
                            <span className="text-lg font-black text-white">Rs.{totals.totalPaypal.toLocaleString()}</span>
                         </div>
                      </div>
                    </div>
                  </div>
                </div>

                {canEdit && (
                  <div className="p-12 bg-slate-50 border-b">
                    <MainEntryForm onAdd={addMainEntry} />
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left table-fixed min-w-[1200px]">
                    <thead className="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b bg-slate-50/50">
                      <tr>
                        <th className="px-10 py-6 w-32">ROOM</th>
                        <th className="px-10 py-6 w-2/5">DESCRIPTIONS</th>
                        <th className="px-10 py-6 w-40 text-center">METHOD</th>
                        <th className="px-10 py-6 w-48 text-right">CASH IN</th>
                        <th className="px-10 py-6 w-48 text-right">CASH OUT</th>
                        {canEdit && <th className="px-10 py-6 w-20 text-center">DEL</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {openingBalance !== 0 && (
                        <tr className="bg-emerald-50/40 font-black">
                          <td className="px-10 py-8 text-emerald-700">OPEN</td>
                          <td className="px-10 py-8 text-emerald-900 italic">BALANCE BROUGHT FORWARD</td>
                          <td className="px-10 py-8 text-center"><MethodBadge method={PaymentMethod.CASH} /></td>
                          <td className="px-10 py-8 text-right text-emerald-600 text-2xl">Rs. {openingBalance.toLocaleString()}</td>
                          <td className="px-10 py-8 text-right text-slate-300">-</td>
                          {canEdit && <td></td>}
                        </tr>
                      )}
                      {mainEntries.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-all highlight-entry">
                          <td className="px-10 py-8 font-black text-slate-900">{e.roomNo || '--'}</td>
                          <td className="px-10 py-8 font-bold text-slate-800 leading-relaxed text-lg">{e.description}</td>
                          <td className="px-10 py-8 text-center">
                            <MethodBadge method={e.method} />
                          </td>
                          <td className="px-10 py-8 text-right font-black text-blue-600 text-2xl">
                            {e.cashIn > 0 ? `Rs. ${e.cashIn.toLocaleString()}` : '-'}
                          </td>
                          <td className="px-10 py-8 text-right font-black text-red-600 text-2xl">
                            {e.cashOut > 0 ? `Rs. ${e.cashOut.toLocaleString()}` : '-'}
                          </td>
                          {canEdit && (
                            <td className="px-10 py-8 text-center">
                              <button onClick={() => removeMainEntry(e.id)} className="text-red-200 hover:text-red-600 font-black text-3xl">&times;</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {canEdit && (
                <div className="flex justify-center pt-10">
                  <button 
                    onClick={handleDayEnd}
                    className="group relative px-24 py-7 font-black text-white bg-red-600 rounded-[2.5rem] overflow-hidden shadow-2xl hover:bg-red-700 active:scale-95 transition-all uppercase tracking-[0.4em] text-lg"
                  >
                    <span className="relative z-10">END CURRENT DAY</span>
                    <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      )}
    </div>
  );
};

// --- Sub-components ---

const RateBox = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className="bg-white border border-slate-100 px-6 py-4 rounded-3xl shadow-sm flex flex-col items-center min-w-[140px]">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">{label} / LKR</span>
    <span className={`text-2xl font-black ${color}`}>Rs. {value}</span>
  </div>
);

const StatPill = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className={`${color} px-6 py-3 rounded-2xl text-white shadow-xl min-w-[150px] text-center`}>
    <p className="text-[10px] font-black opacity-80 uppercase tracking-widest mb-1">{label}</p>
    <p className="text-xl font-black">Rs. {value.toLocaleString()}</p>
  </div>
);

const SummaryStat = ({ label, value, color, border, highlight = false }: { label: string, value: number, color: string, border: string, highlight?: boolean }) => (
  <div className={`${border} border-2 px-8 py-6 rounded-[2rem] bg-slate-800/20 flex flex-col items-center justify-center ${highlight ? 'ring-4 ring-green-500/20 bg-green-950/20 border-green-500/50' : ''}`}>
    <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">{label}</span>
    <span className={`text-3xl font-black ${color}`}>Rs. {value.toLocaleString()}</span>
  </div>
);

const MethodBadge = ({ method }: { method: PaymentMethod }) => {
  const styles = {
    [PaymentMethod.CASH]: "bg-blue-100 text-blue-700 border-blue-200",
    [PaymentMethod.CARD]: "bg-amber-100 text-amber-800 border-amber-400",
    [PaymentMethod.PAYPAL]: "bg-purple-100 text-purple-700 border-purple-200",
  };
  return (
    <span className={`${styles[method]} border px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest`}>
      {method}
    </span>
  );
};

const OutPartyForm = ({ onAdd }: { onAdd: (m: PaymentMethod, a: number) => void }) => {
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [amount, setAmount] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    onAdd(method, parseFloat(amount));
    setAmount(''); // Requirement 24: Clear input
  };

  return (
    <form className="flex flex-wrap items-end gap-8" onSubmit={handleSubmit}>
      <div className="flex-1 min-w-[200px]">
        <label className="block text-[11px] font-black text-slate-500 mb-3 uppercase tracking-widest">Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full bg-white border border-slate-200 p-5 rounded-2xl font-black outline-none focus:ring-4 focus:ring-blue-500/20 transition-all">
          <option value={PaymentMethod.CASH}>CASH</option>
          <option value={PaymentMethod.CARD}>CARD</option>
          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="flex-[2] min-w-[300px]">
        <label className="block text-[11px] font-black text-slate-500 mb-3 uppercase tracking-widest">Amount (Rs)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-white border border-slate-200 p-5 rounded-2xl font-black text-2xl outline-none focus:ring-4 focus:ring-blue-500/20" placeholder="0" />
      </div>
      <button type="submit" className="px-14 py-6 bg-blue-700 text-white font-black rounded-2xl hover:bg-blue-800 shadow-2xl uppercase text-xs tracking-[0.2em] transition-all active:scale-95">Add Entry</button>
    </form>
  );
};

const MainEntryForm = ({ onAdd }: { onAdd: (r: string, d: string, m: PaymentMethod, ci: number, co: number) => void }) => {
  const [room, setRoom] = useState('');
  const [desc, setDesc] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [cashIn, setCashIn] = useState('');
  const [cashOut, setCashOut] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(room, desc, method, parseFloat(cashIn || '0'), parseFloat(cashOut || '0'));
    // Requirement 24: Clear all inputs
    setRoom(''); setDesc(''); setCashIn(''); setCashOut('');
  };

  return (
    <form className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end" onSubmit={handleSubmit}>
      <div className="md:col-span-1">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Room</label>
        <input type="text" value={room} onChange={(e) => setRoom(e.target.value)} className="w-full border-2 p-5 rounded-2xl font-black text-center" placeholder="#" />
      </div>
      <div className="md:col-span-4">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Description (Wide)</label>
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full border-2 p-5 rounded-2xl font-bold" placeholder="Details..." required />
      </div>
      <div className="md:col-span-2">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Payment</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full border-2 p-5 rounded-2xl font-black">
          <option value={PaymentMethod.CASH}>CASH</option>
          <option value={PaymentMethod.CARD}>CARD</option>
          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Cash In</label>
        <input type="number" value={cashIn} onChange={(e) => setCashIn(e.target.value)} className="w-full border-2 p-5 rounded-2xl font-black text-blue-700" placeholder="0" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Cash Out</label>
        <input type="number" value={cashOut} onChange={(e) => setCashOut(e.target.value)} className="w-full border-2 p-5 rounded-2xl font-black text-red-700" placeholder="0" />
      </div>
      <div className="md:col-span-1">
        <button type="submit" className="w-full h-[68px] bg-slate-900 text-white rounded-2xl font-black text-xs hover:bg-black uppercase tracking-widest shadow-xl">ADD</button>
      </div>
    </form>
  );
};

const PairingScreen = ({ onPair }: { onPair: (id: string) => void }) => {
  const [id, setId] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-2xl z-[100] flex items-center justify-center p-6">
      <div className="bg-white p-12 md:p-20 rounded-[4rem] shadow-[0_0_100px_rgba(30,58,138,0.3)] max-w-2xl w-full text-center space-y-12">
        <div className="space-y-4">
          <h2 className="text-5xl font-black text-blue-900 tracking-tighter uppercase">Sync Passkey</h2>
          <p className="text-slate-500 font-bold text-xl">Enter your business ID to connect all devices instantly.</p>
        </div>
        <div className="space-y-8">
          <input 
            type="text" 
            value={id} 
            onChange={(e) => setId(e.target.value)}
            className="w-full p-10 bg-slate-100 rounded-[2.5rem] border-4 border-slate-200 font-black text-4xl text-center outline-none focus:border-blue-600 transition-all uppercase tracking-widest"
            placeholder="SHIVAS-ID"
          />
          <button 
            onClick={() => id && onPair(id)}
            className="w-full p-10 bg-blue-700 text-white font-black rounded-[2.5rem] text-2xl hover:bg-blue-800 shadow-[0_20px_40px_-10px_rgba(29,78,216,0.5)] active:scale-95 transition-all uppercase tracking-[0.2em]"
          >
            Connect Book
          </button>
        </div>
        <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100">
           <p className="text-[12px] font-black text-blue-600 uppercase tracking-widest leading-relaxed">
             Requirement 3: Automatic reconnection logic is now active.<br/>
             This ID is stored locally for future seamless access.
           </p>
        </div>
      </div>
    </div>
  );
};

const HistoryView = ({ history }: { history: HistoryRecord[] }) => (
  <div className="space-y-10 animate-fadeIn">
    <h2 className="text-4xl font-black text-slate-900 uppercase tracking-[0.3em] border-l-[16px] border-slate-900 pl-10">Archived Books</h2>
    <div className="grid gap-8">
      {history.length === 0 ? (
        <div className="p-24 bg-white rounded-[4rem] border-4 border-dashed border-slate-200 text-center text-slate-300 font-black uppercase tracking-widest italic text-2xl">NO PREVIOUS RECORDS FOUND</div>
      ) : (
        history.map((h, i) => (
          <div key={i} className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-12 hover:scale-[1.01] transition-transform">
            <div className="text-center md:text-left">
               <p className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-3">Record Date</p>
               <p className="text-4xl font-black text-slate-900">{h.date}</p>
            </div>
            <div className="flex gap-16">
              <div className="text-center">
                 <p className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-3">Final Closing Balance</p>
                 <p className="text-4xl font-black text-green-600">Rs. {h.finalBalance.toLocaleString()}</p>
              </div>
            </div>
            <button className="px-14 py-5 bg-slate-900 text-white font-black rounded-[2rem] hover:bg-black transition-all uppercase text-xs tracking-[0.2em] shadow-xl">Full Report</button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default App;
