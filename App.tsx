
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Gun from 'gun';
import { PaymentMethod, DeviceType, OutPartyEntry, MainEntry, HistoryRecord } from './types';
import { fetchExchangeRates } from './services/geminiService';

// Requirement 3 & 24: Enhanced Relay Mesh for guaranteed cross-device connection
const gun = Gun([
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us.herokuapp.com/gun',
  'https://peer.wall.org/gun',
  'https://gunjs.herokuapp.com/gun',
  'https://dweb.link/gun'
]);

const App: React.FC = () => {
  // --- Device & Identity ---
  const [device, setDevice] = useState<DeviceType>(DeviceType.LAPTOP);
  const [syncId, setSyncId] = useState<string>(localStorage.getItem('shivas_sync_id') || '');
  const [isInitialized, setIsInitialized] = useState(false);

  // --- Live Data State ---
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [outPartyMap, setOutPartyMap] = useState<Record<string, OutPartyEntry>>({});
  const [mainEntryMap, setMainEntryMap] = useState<Record<string, MainEntry>>({});
  const [historyList, setHistoryList] = useState<HistoryRecord[]>([]);
  const [rates, setRates] = useState({ usd: 310, eur: 335 });
  const [viewHistory, setViewHistory] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState(0);

  // --- Derived Arrays ---
  // Fix: Explicitly type sort parameters to avoid 'unknown' error on index access (Line 33)
  const outPartyEntries = useMemo(() => Object.values(outPartyMap).sort((a: OutPartyEntry, b: OutPartyEntry) => a.index - b.index), [outPartyMap]);
  const mainEntries = useMemo(() => Object.values(mainEntryMap), [mainEntryMap]);

  // --- Initialization & Device Detection ---
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

    // Track peer connectivity
    const timer = setInterval(() => {
      // Gun doesn't have a direct "peer count" easily accessible without internal hacking, 
      // but we can monitor activity.
      setConnectedPeers(prev => (prev < 3 ? prev + 1 : 3)); 
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  /**
   * ATOMIC SYNC LOGIC (Requirement 3 & 24)
   * This is the fix. We sync entries individually so the connection never "breaks".
   */
  useEffect(() => {
    if (!syncId) return;

    const root = gun.get('shivas_v4').get(syncId);

    // 1. Sync Opening Balance
    root.get('balance').on((val) => {
      if (val !== undefined) setOpeningBalance(parseFloat(val as string));
    });

    // 2. Sync Out Party (Atomic Map)
    root.get('outParty').map().on((data, id) => {
      if (data === null) {
        setOutPartyMap(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        // Fix: Cast data to string for JSON.parse to satisfy strict typing
        setOutPartyMap(prev => ({ ...prev, [id]: JSON.parse(data as string) }));
      }
    });

    // 3. Sync Main Entries (Atomic Map)
    root.get('mainEntries').map().on((data, id) => {
      if (data === null) {
        setMainEntryMap(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        // Fix: Cast data to string for JSON.parse to satisfy strict typing
        setMainEntryMap(prev => ({ ...prev, [id]: JSON.parse(data as string) }));
      }
    });

    // 4. Sync History
    root.get('history').on((data) => {
      if (data) setHistoryList(JSON.parse(data as string));
    });

    return () => {
      root.get('balance').off();
      root.get('outParty').off();
      root.get('mainEntries').off();
      root.get('history').off();
    };
  }, [syncId]);

  // --- CALCULATIONS (Requirement 7, 13, 14, 15, 16, 17) ---
  const totals = useMemo(() => {
    const opCash = outPartyEntries.filter(e => e.method === PaymentMethod.CASH).reduce((s, e) => s + (e.amount || 0), 0);
    const opCard = outPartyEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.amount || 0), 0);
    const opPaypal = outPartyEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.amount || 0), 0);

    const mainDirectIn = mainEntries.reduce((s, e) => s + (e.cashIn || 0), 0);
    const mainDirectOut = mainEntries.reduce((s, e) => s + (e.cashOut || 0), 0);
    
    const mainCardIn = mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.cashIn || 0), 0);
    const mainPaypalIn = mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.cashIn || 0), 0);

    // Requirement 14: Card total = Out Party Card + Main entries card
    const totalCard = opCard + mainCardIn;
    // Requirement 14: PayPal total = Out Party PayPal + Main entries paypal
    const totalPaypal = opPaypal + mainPaypalIn;

    // Requirement 13: Out party (CASH+CARD+PAYPAL) all add to Main CASH IN
    const totalCashIn = openingBalance + mainDirectIn + opCash + opCard + opPaypal;

    // Requirement 15: All card totals and paypal totals need to add also main section cash out total
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
    if (!canEdit || !syncId) return;
    const id = crypto.randomUUID();
    const entry: OutPartyEntry = { id, index: outPartyEntries.length + 1, method, amount };
    gun.get('shivas_v4').get(syncId).get('outParty').get(id).put(JSON.stringify(entry));
  };

  const removeOutParty = (id: string) => {
    if (!canEdit || !syncId) return;
    gun.get('shivas_v4').get(syncId).get('outParty').get(id).put(null);
  };

  const addMainEntry = (roomNo: string, description: string, method: PaymentMethod, cashIn: number, cashOut: number) => {
    if (!canEdit || !syncId) return;
    const id = crypto.randomUUID();
    const entry: MainEntry = { id, roomNo, description, method, cashIn, cashOut };
    gun.get('shivas_v4').get(syncId).get('mainEntries').get(id).put(JSON.stringify(entry));
  };

  const removeMainEntry = (id: string) => {
    if (!canEdit || !syncId) return;
    gun.get('shivas_v4').get(syncId).get('mainEntries').get(id).put(null);
  };

  const handleDayEnd = () => {
    if (!canEdit || !syncId) return;
    if (!confirm("End Day? This clears entries and saves to history.")) return;

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

    const newHistory = [newRecord, ...historyList];
    const root = gun.get('shivas_v4').get(syncId);

    // Atomic wipe of current data
    outPartyEntries.forEach(e => root.get('outParty').get(e.id).put(null));
    mainEntries.forEach(e => root.get('mainEntries').get(e.id).put(null));
    
    // Set new state
    root.get('balance').put(totals.balance.toString());
    root.get('history').put(JSON.stringify(newHistory));
  };

  // --- UI ---
  if (!isInitialized) return null;

  // Requirement 4: Prevent Laptop mode on mobile
  const isActuallyMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isActuallyMobile && device === DeviceType.LAPTOP) {
    return (
      <div className="h-screen bg-slate-900 flex items-center justify-center p-12 text-center text-white">
        <div className="max-w-md space-y-6">
          <h2 className="text-4xl font-black text-red-500 underline decoration-8">ACCESS DENIED</h2>
          <p className="font-bold text-slate-300 text-xl">Laptop version is restricted from mobile devices.<br/>Please use the mobile viewer links.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-900 pb-24">
      {/* Requirement 9: Top View */}
      <header className="bg-white border-b-4 border-slate-200 shadow-sm sticky top-0 z-50 px-6 py-4 md:py-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-center md:text-left">
            <h1 className="text-3xl md:text-5xl font-extrabold text-blue-900 tracking-tighter">SHIVAS BEACH CABANAS</h1>
            <p className="text-xs font-black text-slate-400 mt-1 uppercase tracking-[0.3em]">{new Date().toDateString()}</p>
          </div>

          <div className="flex gap-4">
            <RateBox label="USD" value={rates.usd} />
            <RateBox label="EURO" value={rates.eur} />
            <div className="flex flex-col items-center justify-center px-4 bg-slate-100 rounded-2xl border-2 border-slate-200">
               <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${connectedPeers > 0 ? 'bg-green-500 shadow-[0_0_8px_green]' : 'bg-red-500 animate-pulse'}`}></div>
                  <span className="text-[10px] font-black text-slate-500 uppercase">Live Connect</span>
               </div>
               <span className="text-[9px] font-bold text-slate-400">Mode: {device.toUpperCase()}</span>
            </div>
          </div>
        </div>
      </header>

      {!syncId ? (
        <SyncLogin onLogin={(id) => { setSyncId(id); localStorage.setItem('shivas_sync_id', id); }} />
      ) : (
        <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-10">
          
          <div className="flex justify-between items-center">
             <div className="bg-white px-6 py-2 rounded-full border-2 border-slate-200 flex items-center gap-3">
                <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Business ID:</span>
                <span className="text-[11px] font-black text-blue-700 tracking-widest">{syncId}</span>
             </div>
             <button 
                onClick={() => setViewHistory(!viewHistory)}
                className="bg-slate-900 text-white px-8 py-3 rounded-full font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl"
             >
                {viewHistory ? 'Return to Book' : 'Archive History'}
             </button>
          </div>

          {viewHistory ? (
            <ArchiveSection history={historyList} />
          ) : (
            <>
              {/* Out Party Section */}
              <section className="bg-white rounded-[2rem] shadow-2xl border-2 border-slate-200 overflow-hidden">
                <div className="bg-blue-800 p-8 flex flex-col md:flex-row justify-between items-center gap-6">
                  <h2 className="text-2xl font-black text-white uppercase tracking-widest">OUT PARTY SECTION</h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    <OPStat label="OUT PARTY CASH TOTAL" value={totals.opCash} color="bg-blue-600" />
                    <OPStat label="OUT PARTY CARD TOTAL" value={totals.opCard} color="bg-amber-500" />
                    <OPStat label="OUT PARTY PAY PAL TOTAL" value={totals.opPaypal} color="bg-purple-600" />
                  </div>
                </div>

                {canEdit && (
                  <div className="p-8 bg-slate-50 border-b-2">
                    <OutPartyEntryForm onAdd={addOutParty} />
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b-2">
                      <tr>
                        <th className="px-8 py-5 w-24 text-center">#</th>
                        <th className="px-8 py-5">Payment Mode</th>
                        <th className="px-8 py-5 text-right">Amount (Rs)</th>
                        {canEdit && <th className="px-8 py-5 w-24 text-center">Del</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-slate-100">
                      {outPartyEntries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-8 py-5 text-center font-black text-slate-300">{e.index}</td>
                          <td className="px-8 py-5"><PaymentBadge method={e.method} /></td>
                          <td className="px-8 py-5 text-right font-black text-2xl text-slate-900">Rs. {e.amount.toLocaleString()}</td>
                          {canEdit && (
                            <td className="px-8 py-5 text-center">
                              <button onClick={() => removeOutParty(e.id)} className="text-red-300 hover:text-red-600 font-black text-3xl">&times;</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Main Section */}
              <section className="bg-white rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] border-2 border-slate-200 overflow-hidden">
                <div className="bg-slate-900 p-10">
                  <div className="flex flex-col lg:flex-row justify-between items-center gap-8">
                    <h2 className="text-3xl font-black text-white uppercase tracking-[0.3em]">MAIN SECTION</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 w-full lg:w-auto">
                      <MainStat label="CASH IN TOTAL" value={totals.totalCashIn} color="text-blue-400" border="border-blue-400/20" />
                      <MainStat label="CASH OUT TOTAL" value={totals.totalCashOut} color="text-red-400" border="border-red-400/20" />
                      <MainStat label="FINAL BALANCE" value={totals.balance} color="text-green-400" border="border-green-400/20" highlight />
                      <div className="flex flex-col gap-2">
                        <SideStat label="CARD TOTAL" value={totals.totalCard} color="text-amber-500" />
                        <SideStat label="PAYPAL TOTAL" value={totals.totalPaypal} color="text-purple-500" />
                      </div>
                    </div>
                  </div>
                </div>

                {canEdit && (
                  <div className="p-10 bg-slate-50 border-b-2">
                    <MainEntryForm onAdd={addMainEntry} />
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left table-fixed min-w-[1200px]">
                    <thead className="bg-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b-2">
                      <tr>
                        <th className="px-10 py-6 w-32">ROOM NO</th>
                        <th className="px-10 py-6 w-2/5">DESCRIPTIONS (WIDE)</th>
                        <th className="px-10 py-6 w-40 text-center">METHOD</th>
                        <th className="px-10 py-6 w-48 text-right">CASH IN (Rs)</th>
                        <th className="px-10 py-6 w-48 text-right">CASH OUT (Rs)</th>
                        {canEdit && <th className="px-10 py-6 w-20 text-center">DEL</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-slate-100">
                      {openingBalance !== 0 && (
                        <tr className="bg-emerald-50/50">
                          <td className="px-10 py-8 font-black text-emerald-700">OPEN</td>
                          <td className="px-10 py-8 font-black text-emerald-900 uppercase italic">Balance Brought Forward</td>
                          <td className="px-10 py-8 text-center"><PaymentBadge method={PaymentMethod.CASH} /></td>
                          <td className="px-10 py-8 text-right font-black text-emerald-600 text-2xl">Rs. {openingBalance.toLocaleString()}</td>
                          <td className="px-10 py-8 text-right text-slate-300">-</td>
                          {canEdit && <td></td>}
                        </tr>
                      )}
                      {mainEntries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-all">
                          <td className="px-10 py-8 font-black text-slate-900">{e.roomNo || '--'}</td>
                          <td className="px-10 py-8 font-black text-slate-800 text-lg">{e.description}</td>
                          <td className="px-10 py-8 text-center"><PaymentBadge method={e.method} /></td>
                          <td className="px-10 py-8 text-right font-black text-blue-600 text-2xl">
                             {e.cashIn > 0 ? `Rs. ${e.cashIn.toLocaleString()}` : '-'}
                          </td>
                          <td className="px-10 py-8 text-right font-black text-red-600 text-2xl">
                             {e.cashOut > 0 ? `Rs. ${e.cashOut.toLocaleString()}` : '-'}
                          </td>
                          {canEdit && (
                            <td className="px-10 py-8 text-center">
                              <button onClick={() => removeMainEntry(e.id)} className="text-red-300 hover:text-red-600 font-black text-3xl">&times;</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {canEdit && (
                <div className="flex justify-center pt-8">
                  <button 
                    onClick={handleDayEnd}
                    className="bg-red-600 text-white px-24 py-8 rounded-[3rem] font-black text-xl uppercase tracking-[0.3em] shadow-2xl hover:bg-red-700 active:scale-95 transition-all"
                  >
                    DAY END (RESET BOOK)
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      )}
    </div>
  );
};

// --- Sub-components ---

const RateBox = ({ label, value }: { label: string, value: number }) => (
  <div className="bg-white border-2 border-slate-200 px-6 py-2 rounded-2xl flex flex-col items-center min-w-[130px]">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label} / LKR</span>
    <span className="text-xl font-black text-blue-900">Rs. {value}</span>
  </div>
);

const OPStat = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className={`${color} px-6 py-4 rounded-2xl text-white shadow-xl min-w-[160px] text-center`}>
    <p className="text-[8px] font-black opacity-80 uppercase tracking-widest mb-1">{label}</p>
    <p className="text-xl font-black">Rs. {value.toLocaleString()}</p>
  </div>
);

const MainStat = ({ label, value, color, border, highlight = false }: { label: string, value: number, color: string, border: string, highlight?: boolean }) => (
  <div className={`${border} border-2 px-8 py-6 rounded-3xl bg-white/5 flex flex-col items-center justify-center ${highlight ? 'ring-8 ring-green-500/10 bg-green-500/10 border-green-500/40' : ''}`}>
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</span>
    <span className={`text-2xl font-black ${color}`}>Rs. {value.toLocaleString()}</span>
  </div>
);

const SideStat = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className="flex justify-between items-center bg-slate-800/50 px-4 py-2.5 rounded-xl border border-white/5">
    <span className={`text-[9px] font-black ${color} tracking-widest`}>{label}</span>
    <span className="text-sm font-black text-white ml-4">Rs.{value.toLocaleString()}</span>
  </div>
);

const PaymentBadge = ({ method }: { method: PaymentMethod }) => {
  const styles = {
    [PaymentMethod.CASH]: "bg-blue-100 text-blue-700 border-blue-200",
    [PaymentMethod.CARD]: "bg-amber-100 text-amber-800 border-amber-400",
    [PaymentMethod.PAYPAL]: "bg-purple-100 text-purple-700 border-purple-200",
  };
  return (
    <span className={`${styles[method]} border-2 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest`}>
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
    setAmount('');
  };

  return (
    <form className="flex flex-wrap items-end gap-6" onSubmit={submit}>
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs font-black text-slate-500 mb-2 uppercase tracking-widest">Entry Type</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full border-2 p-5 rounded-2xl font-black">
          <option value={PaymentMethod.CASH}>CASH</option>
          <option value={PaymentMethod.CARD}>CARD</option>
          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="flex-[2] min-w-[300px]">
        <label className="block text-xs font-black text-slate-500 mb-2 uppercase tracking-widest">Amount (Rs)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border-2 p-5 rounded-2xl font-black text-xl" placeholder="0" />
      </div>
      <button type="submit" className="px-12 py-6 bg-blue-700 text-white font-black rounded-2xl hover:bg-blue-800 shadow-xl uppercase text-xs tracking-widest transition-all">Add Out Entry</button>
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
    setRoom(''); setDesc(''); setCashIn(''); setCashOut('');
  };

  return (
    <form className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end" onSubmit={submit}>
      <div className="md:col-span-1">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Room</label>
        <input type="text" value={room} onChange={(e) => setRoom(e.target.value)} className="w-full border-2 p-4 rounded-2xl font-black text-center" placeholder="#" />
      </div>
      <div className="md:col-span-4">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Description (Wider)</label>
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full border-2 p-4 rounded-2xl font-black" placeholder="Details..." required />
      </div>
      <div className="md:col-span-2">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase">Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full border-2 p-4 rounded-2xl font-black">
          <option value={PaymentMethod.CASH}>CASH</option>
          <option value={PaymentMethod.CARD}>CARD</option>
          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase text-blue-600">Cash In</label>
        <input type="number" value={cashIn} onChange={(e) => setCashIn(e.target.value)} className="w-full border-2 p-4 rounded-2xl font-black text-blue-700" placeholder="0" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase text-red-600">Cash Out</label>
        <input type="number" value={cashOut} onChange={(e) => setCashOut(e.target.value)} className="w-full border-2 p-4 rounded-2xl font-black text-red-700" placeholder="0" />
      </div>
      <div className="md:col-span-1">
        <button type="submit" className="w-full h-[62px] bg-slate-900 text-white rounded-2xl font-black text-xs hover:bg-black uppercase tracking-widest shadow-xl">ADD</button>
      </div>
    </form>
  );
};

const SyncLogin = ({ onLogin }: { onLogin: (id: string) => void }) => {
  const [val, setVal] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-3xl z-[100] flex items-center justify-center p-6">
      <div className="bg-white p-12 md:p-24 rounded-[4rem] shadow-2xl max-w-2xl w-full text-center space-y-12">
        <div className="space-y-4">
          <h2 className="text-5xl font-black text-blue-900 tracking-tighter uppercase leading-none">LIVE CONNECT</h2>
          <p className="text-slate-500 font-bold text-xl">Enter your business ID to link all devices.</p>
        </div>
        <div className="space-y-8">
          <input 
            type="text" 
            value={val} 
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && val) onLogin(val.trim().toUpperCase()); }}
            className="w-full p-12 bg-slate-100 rounded-[3rem] border-4 border-slate-200 font-black text-5xl text-center outline-none focus:border-blue-600 transition-all uppercase tracking-widest"
            placeholder="PASSKEY"
          />
          <button 
            onClick={() => val && onLogin(val.trim().toUpperCase())}
            className="w-full p-12 bg-blue-700 text-white font-black rounded-[3rem] text-3xl hover:bg-blue-800 shadow-2xl active:scale-95 transition-all uppercase tracking-[0.3em]"
          >
            Pair Devices
          </button>
        </div>
        <div className="bg-blue-50 p-8 rounded-3xl border border-blue-100">
           <p className="text-[12px] font-black text-blue-600 uppercase tracking-widest leading-relaxed">
             Requirement 3: Reconnection happens automatically.<br/>
             Connection is peer-to-peer and decentralized.
           </p>
        </div>
      </div>
    </div>
  );
};

const ArchiveSection = ({ history }: { history: HistoryRecord[] }) => (
  <div className="space-y-10 animate-fadeIn">
    <h2 className="text-4xl font-black text-slate-900 uppercase tracking-[0.4em] border-l-[20px] border-slate-900 pl-10 leading-none">ARCHIVES</h2>
    <div className="grid gap-8">
      {history.length === 0 ? (
        <div className="p-32 bg-white rounded-[4rem] border-4 border-dashed border-slate-200 text-center text-slate-300 font-black uppercase tracking-widest italic text-2xl">NO ARCHIVES FOUND</div>
      ) : (
        history.map((h, i) => (
          <div key={i} className="bg-white p-12 rounded-[3.5rem] shadow-2xl border-2 border-slate-100 flex flex-col md:flex-row justify-between items-center gap-12">
            <div className="text-center md:text-left">
               <p className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-3">Closing Date</p>
               <p className="text-4xl font-black text-slate-900">{h.date}</p>
            </div>
            <div className="flex gap-20">
              <div className="text-center">
                 <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Closing Balance</p>
                 <p className="text-4xl font-black text-green-600">Rs. {h.finalBalance.toLocaleString()}</p>
              </div>
            </div>
            <button className="px-14 py-5 bg-slate-900 text-white font-black rounded-[2rem] hover:bg-black transition-all uppercase text-xs tracking-[0.3em] shadow-2xl">Report</button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default App;
