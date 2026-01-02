
import React, { useState, useEffect, useMemo, useRef } from 'react';
import Gun from 'gun';
import { PaymentMethod, DeviceType, OutPartyEntry, MainEntry, HistoryRecord } from './types';
import { fetchExchangeRates } from './services/geminiService';

/**
 * Requirement 3 & 24: Multiple high-reliability relay peers to ensure 
 * Laptop and Mobile connect smoothly across different networks.
 */
const gun = Gun([
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us.herokuapp.com/gun',
  'https://gun-eu.herokuapp.com/gun',
  'https://gunjs.herokuapp.com/gun'
]);

const App: React.FC = () => {
  // --- Device & Identity ---
  const [device, setDevice] = useState<DeviceType>(DeviceType.LAPTOP);
  const [syncId, setSyncId] = useState<string>(localStorage.getItem('shivas_sync_id') || '');
  const [isInitialized, setIsInitialized] = useState(false);

  // --- State ---
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [outPartyEntries, setOutPartyEntries] = useState<OutPartyEntry[]>([]);
  const [mainEntries, setMainEntries] = useState<MainEntry[]>([]);
  const [rates, setRates] = useState({ usd: 310, eur: 335 });
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [viewHistory, setViewHistory] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'offline' | 'connecting' | 'synced'>('connecting');

  // --- Initialization ---
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (Object.values(DeviceType).includes(hash as DeviceType)) {
      setDevice(hash as DeviceType);
    } else {
      const ua = navigator.userAgent;
      if (/Android/i.test(ua)) setDevice(DeviceType.ANDROID);
      else if (/iPhone|iPad|iPod/i.test(ua)) setDevice(DeviceType.IPHONE);
      else setDevice(DeviceType.LAPTOP);
    }
    fetchExchangeRates().then(setRates);
    setIsInitialized(true);
  }, []);

  /**
   * LIVE CONNECT LOGIC (Requirement 3 & 24)
   * Using GunJS to bridge Laptop and Mobile via a common syncId.
   */
  useEffect(() => {
    if (!syncId) return;

    // Use a unique namespace node for Shivas
    const node = gun.get('shivas_beach_v3').get(syncId);

    // Initial load and continuous sync for each data part
    const h1 = node.get('outParty').on((data) => {
      if (data) setOutPartyEntries(JSON.parse(data));
      setSyncStatus('synced');
    });

    const h2 = node.get('main').on((data) => {
      if (data) setMainEntries(JSON.parse(data));
    });

    const h3 = node.get('history').on((data) => {
      if (data) setHistory(JSON.parse(data));
    });

    const h4 = node.get('balance').on((data) => {
      if (data !== undefined) setOpeningBalance(parseFloat(data));
    });

    return () => {
      node.get('outParty').off();
      node.get('main').off();
      node.get('history').off();
      node.get('balance').off();
    };
  }, [syncId]);

  /**
   * PERSISTENCE (Requirement 3)
   * Laptop writes to Gun node, Mobile devices listen and update UI automatically.
   */
  const persist = (updates: { 
    outPartyEntries?: OutPartyEntry[], 
    mainEntries?: MainEntry[], 
    history?: HistoryRecord[], 
    openingBalance?: number 
  }) => {
    if (!syncId || device !== DeviceType.LAPTOP) return;
    const node = gun.get('shivas_beach_v3').get(syncId);
    
    if (updates.outPartyEntries) node.get('outParty').put(JSON.stringify(updates.outPartyEntries));
    if (updates.mainEntries) node.get('main').put(JSON.stringify(updates.mainEntries));
    if (updates.history) node.get('history').put(JSON.stringify(updates.history));
    if (updates.openingBalance !== undefined) node.get('balance').put(updates.openingBalance.toString());
  };

  // --- CALCULATIONS (Requirements 7, 13, 14, 15, 16, 17) ---
  const totals = useMemo(() => {
    // Out Party Method Totals
    const opCash = outPartyEntries.filter(e => e.method === PaymentMethod.CASH).reduce((s, e) => s + (e.amount || 0), 0);
    const opCard = outPartyEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.amount || 0), 0);
    const opPaypal = outPartyEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.amount || 0), 0);

    // Main entries totals
    const mainDirectIn = mainEntries.reduce((s, e) => s + (e.cashIn || 0), 0);
    const mainDirectOut = mainEntries.reduce((s, e) => s + (e.cashOut || 0), 0);
    const mainCardIn = mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.cashIn || 0), 0);
    const mainPaypalIn = mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.cashIn || 0), 0);

    // Requirement 14: Main Card Total = Out Party Card + Main entries card in
    const totalCard = opCard + mainCardIn;
    // Requirement 14: Main PayPal Total = Out Party PayPal + Main entries pay pal in
    const totalPaypal = opPaypal + mainPaypalIn;

    // Requirement 13: All Out Party collections (Cash, Card, PayPal) add to Main CASH IN
    const totalCashIn = openingBalance + mainDirectIn + opCash + opCard + opPaypal;

    // Requirement 15: All card totals and paypal totals add to Main CASH OUT
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
    if (!confirm("Are you sure? This will archive today's data and reset for tomorrow.")) return;

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

  // --- UI Blocks ---
  if (!isInitialized) return null;

  const isActuallyMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isActuallyMobile && device === DeviceType.LAPTOP) {
    return (
      <div className="h-screen bg-slate-900 flex items-center justify-center p-10 text-center">
        <div className="bg-white p-12 rounded-[3rem] shadow-2xl space-y-4 max-w-sm">
          <h2 className="text-3xl font-black text-red-600">INVALID DEVICE</h2>
          <p className="font-bold text-slate-500">Laptop mode is not permitted on mobile devices. Use Android/iPhone links.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-900 pb-20">
      {/* Header - Requirements 9 & 12 */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-50 p-6 md:px-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-3xl md:text-4xl font-extrabold text-blue-900 tracking-tight uppercase">SHIVAS BEACH CABANAS</h1>
            <div className="flex gap-3 justify-center md:justify-start items-center mt-2">
              <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-100">{new Date().toDateString()}</span>
              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${canEdit ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                {device} mode
              </span>
            </div>
          </div>

          <div className="flex gap-4">
            <RateCard label="USD" value={rates.usd} icon="🇺🇸" />
            <RateCard label="EURO" value={rates.eur} icon="🇪🇺" />
          </div>
        </div>
      </header>

      {!syncId ? (
        <PairingScreen onPair={(id) => { setSyncId(id); localStorage.setItem('shivas_sync_id', id); }} />
      ) : (
        <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-12">
          
          <div className="flex justify-between items-center">
             <div className="flex items-center gap-3 bg-white px-5 py-2 rounded-full border shadow-sm">
                <div className={`w-3 h-3 rounded-full ${syncStatus === 'synced' ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-yellow-400 animate-pulse'}`}></div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {syncStatus === 'synced' ? `AUTO CONNECTED: ${syncId}` : 'SEARCHING PEERS...'}
                </span>
             </div>
             <button 
                onClick={() => setViewHistory(!viewHistory)}
                className="bg-slate-900 text-white px-8 py-3 rounded-full font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95"
             >
                {viewHistory ? 'Close Archives' : 'View History'}
             </button>
          </div>

          {viewHistory ? (
            <ArchiveList history={history} />
          ) : (
            <div className="space-y-12">
              {/* Out Party Section - Requirement 5, 6, 7, 8 */}
              <section className="bg-white rounded-[3rem] shadow-xl border border-slate-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-700 to-indigo-800 p-10 flex flex-col md:flex-row justify-between items-center gap-8">
                  <h2 className="text-2xl font-black text-white uppercase tracking-[0.2em]">OUT PARTY</h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    <MiniStat label="OP CASH" value={totals.opCash} color="bg-blue-500" />
                    <MiniStat label="OP CARD" value={totals.opCard} color="bg-amber-500" />
                    <MiniStat label="OP PAYPAL" value={totals.opPaypal} color="bg-purple-600" />
                  </div>
                </div>

                {canEdit && (
                  <div className="p-10 bg-blue-50/30 border-b border-blue-100">
                    <OutPartyEntryForm onAdd={addOutParty} />
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-[11px] font-black text-slate-400 uppercase tracking-widest border-b">
                      <tr>
                        <th className="px-10 py-5 w-24">#</th>
                        <th className="px-10 py-5">Method</th>
                        <th className="px-10 py-5 text-right">Amount (Rs)</th>
                        {canEdit && <th className="px-10 py-5 w-24 text-center">Delete</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {outPartyEntries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-10 py-5 font-black text-slate-300">{e.index}</td>
                          <td className="px-10 py-5">
                            <PaymentBadge method={e.method} />
                          </td>
                          <td className="px-10 py-5 text-right font-black text-2xl">
                            Rs. {e.amount.toLocaleString()}
                          </td>
                          {canEdit && (
                            <td className="px-10 py-5 text-center">
                              <button onClick={() => removeOutParty(e.id)} className="text-red-300 hover:text-red-600 font-black text-3xl leading-none transition-all">&times;</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {outPartyEntries.length === 0 && <div className="p-16 text-center text-slate-300 font-bold uppercase tracking-widest italic">No out party data</div>}
                </div>
              </section>

              {/* Main Section - Requirement 5, 10, 11, 13-17 */}
              <section className="bg-white rounded-[3rem] shadow-2xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-900 p-12">
                  <div className="flex flex-col lg:flex-row justify-between items-center gap-10">
                    <h2 className="text-2xl font-black text-white uppercase tracking-[0.4em]">MAIN CASH BOOK</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 w-full lg:w-auto">
                      <SummaryCard label="CASH IN" value={totals.totalCashIn} color="text-blue-400" border="border-blue-400/30" />
                      <SummaryCard label="CASH OUT" value={totals.totalCashOut} color="text-red-400" border="border-red-400/30" />
                      <SummaryCard label="BALANCE" value={totals.balance} color="text-green-400" border="border-green-400/30" highlight />
                      <div className="space-y-2">
                        <SideStat label="CARD TOTAL" value={totals.totalCard} color="text-amber-500" />
                        <SideStat label="PAYPAL TOTAL" value={totals.totalPaypal} color="text-purple-500" />
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
                    <thead className="bg-slate-50 text-[11px] font-black text-slate-400 uppercase tracking-widest border-b">
                      <tr>
                        <th className="px-10 py-6 w-32">ROOM</th>
                        <th className="px-10 py-6 w-2/5">DESCRIPTION (WIDER)</th>
                        <th className="px-10 py-6 w-40 text-center">PAYMENT</th>
                        <th className="px-10 py-6 w-48 text-right">CASH IN (Rs)</th>
                        <th className="px-10 py-6 w-48 text-right">CASH OUT (Rs)</th>
                        {canEdit && <th className="px-10 py-6 w-24 text-center">DEL</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {openingBalance !== 0 && (
                        <tr className="bg-emerald-50/50 font-black">
                          <td className="px-10 py-8 text-emerald-700">OPEN</td>
                          <td className="px-10 py-8 text-emerald-900 uppercase italic text-sm">Balance Brought Forward</td>
                          <td className="px-10 py-8 text-center"><PaymentBadge method={PaymentMethod.CASH} /></td>
                          <td className="px-10 py-8 text-right text-emerald-600 text-2xl">Rs. {openingBalance.toLocaleString()}</td>
                          <td className="px-10 py-8 text-right text-slate-300">-</td>
                          {canEdit && <td className="px-10 py-8"></td>}
                        </tr>
                      )}
                      {mainEntries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-all group">
                          <td className="px-10 py-8 font-black text-slate-900">{e.roomNo || '--'}</td>
                          <td className="px-10 py-8 font-bold text-slate-800 text-lg leading-snug">{e.description}</td>
                          <td className="px-10 py-8 text-center">
                            <PaymentBadge method={e.method} />
                          </td>
                          <td className="px-10 py-8 text-right font-black text-blue-600 text-2xl">
                            {e.cashIn > 0 ? `Rs. ${e.cashIn.toLocaleString()}` : '-'}
                          </td>
                          <td className="px-10 py-8 text-right font-black text-red-600 text-2xl">
                            {e.cashOut > 0 ? `Rs. ${e.cashOut.toLocaleString()}` : '-'}
                          </td>
                          {canEdit && (
                            <td className="px-10 py-8 text-center opacity-40 group-hover:opacity-100">
                              <button onClick={() => removeMainEntry(e.id)} className="text-red-400 hover:text-red-600 font-black text-3xl">&times;</button>
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
                    className="group relative px-28 py-8 font-black text-white bg-red-600 rounded-[3rem] overflow-hidden shadow-2xl hover:bg-red-700 active:scale-95 transition-all uppercase tracking-[0.5em] text-xl"
                  >
                    <span className="relative z-10">DAY END (RESET)</span>
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

const RateCard = ({ label, value, icon }: { label: string, value: number, icon: string }) => (
  <div className="bg-white border border-slate-100 px-6 py-4 rounded-3xl shadow-sm flex flex-col items-center min-w-[140px] highlight-card">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{icon} {label} / LKR</span>
    <span className="text-2xl font-black text-blue-900">Rs. {value}</span>
  </div>
);

const MiniStat = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className={`${color} px-6 py-3 rounded-2xl text-white shadow-xl min-w-[150px] text-center`}>
    <p className="text-[9px] font-black opacity-80 uppercase tracking-widest mb-1">{label} TOTAL</p>
    <p className="text-xl font-black">Rs. {value.toLocaleString()}</p>
  </div>
);

const SummaryCard = ({ label, value, color, border, highlight = false }: { label: string, value: number, color: string, border: string, highlight?: boolean }) => (
  <div className={`${border} border-2 px-8 py-6 rounded-[2.5rem] bg-white/5 flex flex-col items-center justify-center ${highlight ? 'ring-8 ring-green-500/10 bg-green-500/10 border-green-500/40' : ''}`}>
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">{label} TOTAL</span>
    <span className={`text-3xl font-black ${color}`}>Rs. {value.toLocaleString()}</span>
  </div>
);

const SideStat = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className="flex justify-between items-center bg-slate-800/50 p-4 rounded-2xl border border-white/5">
    <span className={`text-[9px] font-black ${color} tracking-widest`}>{label}</span>
    <span className="text-lg font-black text-white">Rs.{value.toLocaleString()}</span>
  </div>
);

const PaymentBadge = ({ method }: { method: PaymentMethod }) => {
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

const OutPartyEntryForm = ({ onAdd }: { onAdd: (m: PaymentMethod, a: number) => void }) => {
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [amount, setAmount] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    onAdd(method, parseFloat(amount));
    setAmount(''); // Requirement 24: Clear input
  };

  return (
    <form className="flex flex-wrap items-end gap-8" onSubmit={submit}>
      <div className="flex-1 min-w-[200px]">
        <label className="block text-[11px] font-black text-slate-500 mb-3 uppercase tracking-widest">Entry Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full bg-white border border-slate-200 p-5 rounded-3xl font-black outline-none focus:ring-4 focus:ring-blue-500/20 transition-all">
          <option value={PaymentMethod.CASH}>CASH</option>
          <option value={PaymentMethod.CARD}>CARD</option>
          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="flex-[2] min-w-[300px]">
        <label className="block text-[11px] font-black text-slate-500 mb-3 uppercase tracking-widest">Amount (Rs)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-white border border-slate-200 p-5 rounded-3xl font-black text-2xl outline-none focus:ring-4 focus:ring-blue-500/20" placeholder="0" />
      </div>
      <button type="submit" className="px-14 py-6 bg-blue-700 text-white font-black rounded-3xl hover:bg-blue-800 shadow-2xl uppercase text-xs tracking-[0.3em] transition-all active:scale-95">Add Entry</button>
    </form>
  );
};

const MainEntryForm = ({ onAdd }: { onAdd: (r: string, d: string, m: PaymentMethod, ci: number, co: number) => void }) => {
  const [room, setRoom] = useState('');
  const [desc, setDesc] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [cashIn, setCashIn] = useState('');
  const [cashOut, setCashOut] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(room, desc, method, parseFloat(cashIn || '0'), parseFloat(cashOut || '0'));
    // Requirement 24: Clear inputs
    setRoom(''); setDesc(''); setCashIn(''); setCashOut('');
  };

  return (
    <form className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end" onSubmit={submit}>
      <div className="md:col-span-1">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Room</label>
        <input type="text" value={room} onChange={(e) => setRoom(e.target.value)} className="w-full border-2 p-5 rounded-3xl font-black text-center" placeholder="#" />
      </div>
      <div className="md:col-span-4">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Description (Wider)</label>
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full border-2 p-5 rounded-3xl font-bold" placeholder="Guest details..." required />
      </div>
      <div className="md:col-span-2">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full border-2 p-5 rounded-3xl font-black">
          <option value={PaymentMethod.CASH}>CASH</option>
          <option value={PaymentMethod.CARD}>CARD</option>
          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase text-blue-600">Cash In</label>
        <input type="number" value={cashIn} onChange={(e) => setCashIn(e.target.value)} className="w-full border-2 p-5 rounded-3xl font-black text-blue-700" placeholder="0" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase text-red-600">Cash Out</label>
        <input type="number" value={cashOut} onChange={(e) => setCashOut(e.target.value)} className="w-full border-2 p-5 rounded-3xl font-black text-red-700" placeholder="0" />
      </div>
      <div className="md:col-span-1">
        <button type="submit" className="w-full h-[72px] bg-slate-900 text-white rounded-3xl font-black text-xs hover:bg-black uppercase tracking-widest shadow-xl">ADD</button>
      </div>
    </form>
  );
};

const PairingScreen = ({ onPair }: { onPair: (id: string) => void }) => {
  const [val, setVal] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-2xl z-[100] flex items-center justify-center p-6">
      <div className="bg-white p-12 md:p-24 rounded-[5rem] shadow-[0_0_150px_-20px_rgba(30,58,138,0.5)] max-w-2xl w-full text-center space-y-12">
        <div className="space-y-4">
          <h2 className="text-5xl font-black text-blue-900 tracking-tighter uppercase leading-none">Business Pairing</h2>
          <p className="text-slate-500 font-bold text-xl">Sync all devices with your unique passkey.</p>
        </div>
        <div className="space-y-8">
          <input 
            type="text" 
            value={val} 
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && val) onPair(val.trim()); }}
            className="w-full p-12 bg-slate-100 rounded-[3rem] border-4 border-slate-200 font-black text-5xl text-center outline-none focus:border-blue-600 transition-all uppercase tracking-widest"
            placeholder="PASSKEY"
          />
          <button 
            onClick={() => val && onPair(val.trim())}
            className="w-full p-12 bg-blue-700 text-white font-black rounded-[3rem] text-3xl hover:bg-blue-800 shadow-[0_30px_60px_-15px_rgba(29,78,216,0.6)] active:scale-95 transition-all uppercase tracking-[0.3em]"
          >
            Connect Now
          </button>
        </div>
        <div className="bg-blue-50 p-8 rounded-[2rem] border border-blue-100">
           <p className="text-xs font-black text-blue-600 uppercase tracking-widest leading-relaxed">
             Requirement 3: Reconnection happens automatically.<br/>
             Sync is maintained across all sessions.
           </p>
        </div>
      </div>
    </div>
  );
};

const ArchiveList = ({ history }: { history: HistoryRecord[] }) => (
  <div className="space-y-10 animate-fadeIn">
    <h2 className="text-4xl font-black text-slate-900 uppercase tracking-[0.4em] border-l-[20px] border-slate-900 pl-10 leading-none">ARCHIVES</h2>
    <div className="grid gap-8">
      {history.length === 0 ? (
        <div className="p-32 bg-white rounded-[4rem] border-4 border-dashed border-slate-200 text-center text-slate-300 font-black uppercase tracking-widest italic text-2xl">NO ARCHIVES FOUND</div>
      ) : (
        history.map((h, i) => (
          <div key={i} className="bg-white p-14 rounded-[4rem] shadow-2xl border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-12 highlight-card">
            <div className="text-center md:text-left">
               <p className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-3">Closing Date</p>
               <p className="text-4xl font-black text-slate-900">{h.date}</p>
            </div>
            <div className="flex gap-20">
              <div className="text-center">
                 <p className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-3">Final Closing Balance</p>
                 <p className="text-4xl font-black text-green-600">Rs. {h.finalBalance.toLocaleString()}</p>
              </div>
            </div>
            <button className="px-16 py-6 bg-slate-900 text-white font-black rounded-[2.5rem] hover:bg-black transition-all uppercase text-xs tracking-[0.3em] shadow-2xl">Report</button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default App;
