
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Gun from 'gun';
import { QRCodeSVG } from 'qrcode.react';
import { PaymentMethod, DeviceType, OutPartyEntry, MainEntry, HistoryRecord } from './types';
import { fetchExchangeRates } from './services/geminiService';

/**
 * Requirement 3 & 24: ULTIMATE MESH RELAY
 * Using a diverse pool of public relays to bypass regional network restrictions.
 */
const gun = Gun([
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us.herokuapp.com/gun',
  'https://peer.wall.org/gun',
  'https://gunjs.herokuapp.com/gun',
  'https://dweb.link/gun',
  'https://gun-ams.herokuapp.com/gun',
  'https://gun-sjc.herokuapp.com/gun',
  'https://relay.p2p.legal/gun'
]);

const App: React.FC = () => {
  // --- Identity & State ---
  const [device, setDevice] = useState<DeviceType>(DeviceType.LAPTOP);
  const [syncId, setSyncId] = useState<string>(() => {
    // Try to get from URL first (for mobile QR scan), then localStorage
    const params = new URLSearchParams(window.location.search);
    return params.get('sid') || localStorage.getItem('shivas_sync_id') || '';
  });
  const [isInitialized, setIsInitialized] = useState(false);

  // --- Real-time Data ---
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [outPartyMap, setOutPartyMap] = useState<Record<string, OutPartyEntry>>({});
  const [mainEntryMap, setMainEntryMap] = useState<Record<string, MainEntry>>({});
  const [historyList, setHistoryList] = useState<HistoryRecord[]>([]);
  const [rates, setRates] = useState({ usd: 310, eur: 335 });
  const [viewHistory, setViewHistory] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'searching' | 'connected'>('searching');

  // --- Derived Collections ---
  // Fix: Explicitly cast Object.values to OutPartyEntry[] to avoid "unknown" type error in sort callback (Line 45)
  const outPartyEntries = useMemo(() => (Object.values(outPartyMap) as OutPartyEntry[]).sort((a, b) => a.index - b.index), [outPartyMap]);
  // Fix: Explicitly cast Object.values to MainEntry[] for consistent typing and to prevent inference errors
  const mainEntries = useMemo(() => Object.values(mainEntryMap) as MainEntry[], [mainEntryMap]);

  // --- Core Lifecycle ---
  useEffect(() => {
    // 1. Determine Device Mode
    const hash = window.location.hash.replace('#', '');
    const ua = navigator.userAgent;
    if (Object.values(DeviceType).includes(hash as DeviceType)) {
      setDevice(hash as DeviceType);
    } else if (/Android/i.test(ua)) {
      setDevice(DeviceType.ANDROID);
    } else if (/iPhone|iPad|iPod/i.test(ua)) {
      setDevice(DeviceType.IPHONE);
    } else {
      setDevice(DeviceType.LAPTOP);
    }

    // 2. Fetch Global Rates
    fetchExchangeRates().then(setRates);
    setIsInitialized(true);
    
    // Auto-save sync ID if it came from URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('sid')) {
      localStorage.setItem('shivas_sync_id', params.get('sid')!);
    }
  }, []);

  /**
   * HYPER-STABLE SYNC ENGINE
   */
  useEffect(() => {
    if (!syncId) return;

    const root = gun.get('shivas_mesh_v5').get(syncId);

    // Opening Balance
    root.get('balance').on((v) => {
      if (v !== undefined) {
        setOpeningBalance(parseFloat(v as string));
        setSyncStatus('connected');
      }
    });

    // Out Party Map (Atomic)
    root.get('outParty').map().on((data, id) => {
      if (data === null) {
        setOutPartyMap(prev => { const n = { ...prev }; delete n[id]; return n; });
      } else {
        setOutPartyMap(prev => ({ ...prev, [id]: JSON.parse(data as string) }));
        setSyncStatus('connected');
      }
    });

    // Main Book Map (Atomic)
    root.get('main').map().on((data, id) => {
      if (data === null) {
        setMainEntryMap(prev => { const n = { ...prev }; delete n[id]; return n; });
      } else {
        setMainEntryMap(prev => ({ ...prev, [id]: JSON.parse(data as string) }));
        setSyncStatus('connected');
      }
    });

    // History
    root.get('history').on((data) => {
      if (data) setHistoryList(JSON.parse(data as string));
    });

    return () => { root.off(); };
  }, [syncId]);

  // --- Calculations (Requirements 13, 14, 15) ---
  const totals = useMemo(() => {
    const opCash = outPartyEntries.filter(e => e.method === PaymentMethod.CASH).reduce((s, e) => s + (e.amount || 0), 0);
    const opCard = outPartyEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.amount || 0), 0);
    const opPaypal = outPartyEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.amount || 0), 0);

    const mDirectIn = mainEntries.reduce((s, e) => s + (e.cashIn || 0), 0);
    const mDirectOut = mainEntries.reduce((s, e) => s + (e.cashOut || 0), 0);
    
    const mCardIn = mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.cashIn || 0), 0);
    const mPaypalIn = mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.cashIn || 0), 0);

    // Requirement 14: Total Card = Out Party Card + Main entries card
    const totalCard = opCard + mCardIn;
    // Requirement 14: Total PayPal = Out Party PayPal + Main entries paypal
    const totalPaypal = opPaypal + mPaypalIn;

    // Requirement 13: All out party collections go into CASH IN
    const totalCashIn = openingBalance + mDirectIn + opCash + opCard + opPaypal;

    // Requirement 15: Card and PayPal totals must also be deducted/accounted in CASH OUT
    const totalCashOut = mDirectOut + totalCard + totalPaypal;

    return {
      opCash, opCard, opPaypal,
      totalCard, totalPaypal,
      totalCashIn, totalCashOut,
      balance: totalCashIn - totalCashOut
    };
  }, [outPartyEntries, mainEntries, openingBalance]);

  // --- Handlers ---
  const canEdit = device === DeviceType.LAPTOP;

  const addOutParty = (method: PaymentMethod, amount: number) => {
    if (!canEdit || !syncId) return;
    const id = crypto.randomUUID();
    const entry: OutPartyEntry = { id, index: outPartyEntries.length + 1, method, amount };
    gun.get('shivas_mesh_v5').get(syncId).get('outParty').get(id).put(JSON.stringify(entry));
  };

  const removeOutParty = (id: string) => {
    if (!canEdit || !syncId) return;
    gun.get('shivas_mesh_v5').get(syncId).get('outParty').get(id).put(null);
  };

  const addMainEntry = (roomNo: string, description: string, method: PaymentMethod, cashIn: number, cashOut: number) => {
    if (!canEdit || !syncId) return;
    const id = crypto.randomUUID();
    const entry: MainEntry = { id, roomNo, description, method, cashIn, cashOut };
    gun.get('shivas_mesh_v5').get(syncId).get('main').get(id).put(JSON.stringify(entry));
  };

  const removeMainEntry = (id: string) => {
    if (!canEdit || !syncId) return;
    gun.get('shivas_mesh_v5').get(syncId).get('main').get(id).put(null);
  };

  const handleDayEnd = () => {
    if (!canEdit || !syncId) return;
    if (!confirm("Closing the book. Today's balance will become tomorrow's Opening Balance.")) return;

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
    const root = gun.get('shivas_mesh_v5').get(syncId);

    // Clear current board
    outPartyEntries.forEach(e => root.get('outParty').get(e.id).put(null));
    mainEntries.forEach(e => root.get('main').get(e.id).put(null));
    
    root.get('balance').put(totals.balance.toString());
    root.get('history').put(JSON.stringify(newHistory));
  };

  // --- QR URL Construction ---
  const viewerUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const baseUrl = window.location.href.split('?')[0];
    return `${baseUrl}?sid=${syncId}#${DeviceType.ANDROID}`;
  }, [syncId]);

  // --- UI ---
  if (!isInitialized) return null;

  // Block laptop mode on mobile - Requirement 4
  const isActuallyMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isActuallyMobile && device === DeviceType.LAPTOP) {
    return (
      <div className="h-screen bg-slate-900 flex flex-col items-center justify-center p-10 text-center text-white">
        <h2 className="text-3xl font-black text-red-500 mb-4">RESTRICTED ACCESS</h2>
        <p className="font-bold text-slate-400">The Laptop interface is not available on mobile. Use the Viewer link or scan the QR code from the laptop.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-900 pb-32">
      {/* Header - Requirement 9 */}
      <header className="bg-white border-b-8 border-blue-900 sticky top-0 z-50 p-6 shadow-xl">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-4xl md:text-5xl font-black text-blue-900 tracking-tighter uppercase leading-none">SHIVAS BEACH CABANAS</h1>
            <div className="flex items-center justify-center md:justify-start gap-4 mt-3">
              <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-4 py-1.5 rounded-full uppercase tracking-widest">{new Date().toDateString()}</span>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${syncStatus === 'connected' ? 'bg-green-500 pulse-live' : 'bg-red-500'}`}></div>
                <span className="text-[10px] font-black uppercase text-slate-400">Mesh {syncStatus}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <RateBox label="USD" value={rates.usd} icon="🇺🇸" />
            <RateBox label="EURO" value={rates.eur} icon="🇪🇺" />
            {canEdit && (
              <button 
                onClick={() => setShowQr(true)}
                className="bg-blue-100 text-blue-700 p-4 rounded-3xl hover:bg-blue-200 transition-all border-2 border-blue-200"
                title="Scan to sync mobile"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {!syncId ? (
        <SyncSetup onSet={(id) => { setSyncId(id); localStorage.setItem('shivas_sync_id', id); }} />
      ) : (
        <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-12 animate-in fade-in duration-700">
          
          <div className="flex justify-between items-center bg-white p-6 rounded-[2.5rem] border-2 border-slate-200 shadow-sm">
             <div className="flex items-center gap-4">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Secure Room ID:</span>
                <span className="text-xl font-black text-blue-800 tracking-widest select-all">{syncId}</span>
             </div>
             <button 
                onClick={() => setViewHistory(!viewHistory)}
                className="bg-slate-900 text-white px-10 py-4 rounded-full font-black text-xs uppercase tracking-widest hover:bg-black active:scale-95 transition-all shadow-xl"
             >
                {viewHistory ? 'Return to Current Book' : 'Archives History'}
             </button>
          </div>

          {viewHistory ? (
            <ArchiveView history={historyList} />
          ) : (
            <>
              {/* Out Party Section */}
              <section className="bg-white rounded-[3rem] shadow-2xl border-4 border-slate-200 overflow-hidden">
                <div className="bg-blue-700 p-10 flex flex-col md:flex-row justify-between items-center gap-8">
                  <h2 className="text-3xl font-black text-white uppercase tracking-[0.2em]">OUT PARTY</h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    <StatPill label="OP CASH" value={totals.opCash} color="bg-blue-600" />
                    <StatPill label="OP CARD" value={totals.opCard} color="bg-amber-600" />
                    <StatPill label="OP PAYPAL" value={totals.opPaypal} color="bg-purple-700" />
                  </div>
                </div>

                {canEdit && (
                  <div className="p-10 bg-blue-50/50 border-b-4 border-blue-100">
                    <OutPartyEntryForm onAdd={addOutParty} />
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-100 text-[11px] font-black text-slate-500 uppercase tracking-[0.2em] border-b-4">
                      <tr>
                        <th className="px-10 py-6 w-24 text-center">No</th>
                        <th className="px-10 py-6">Payment Method</th>
                        <th className="px-10 py-6 text-right">Amount (LKR)</th>
                        {canEdit && <th className="px-10 py-6 w-24 text-center">Del</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-slate-100">
                      {(outPartyEntries as OutPartyEntry[]).map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-all group">
                          <td className="px-10 py-6 text-center font-black text-slate-300 text-xl">{e.index}</td>
                          <td className="px-10 py-6"><MethodBadge method={e.method} /></td>
                          <td className="px-10 py-6 text-right font-black text-3xl text-slate-900">Rs. {e.amount.toLocaleString()}</td>
                          {canEdit && (
                            <td className="px-10 py-6 text-center">
                              <button onClick={() => removeOutParty(e.id)} className="text-red-300 hover:text-red-600 font-black text-4xl transition-colors">&times;</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {outPartyEntries.length === 0 && <div className="p-20 text-center text-slate-300 font-black uppercase tracking-widest text-xl italic">No Out Party entries today</div>}
                </div>
              </section>

              {/* Main Section */}
              <section className="bg-white rounded-[3rem] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.3)] border-4 border-slate-200 overflow-hidden">
                <div className="bg-slate-900 p-12">
                  <div className="flex flex-col lg:flex-row justify-between items-center gap-10">
                    <h2 className="text-4xl font-black text-white uppercase tracking-[0.3em]">MAIN CASH BOOK</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 w-full lg:w-auto">
                      <TotalCard label="CASH IN" value={totals.totalCashIn} color="text-blue-400" />
                      <TotalCard label="CASH OUT" value={totals.totalCashOut} color="text-red-400" />
                      <TotalCard label="FINAL BALANCE" value={totals.balance} color="text-green-400" highlight />
                      <div className="flex flex-col gap-3">
                        <SmallTotal label="CARD TOTAL" value={totals.totalCard} color="text-amber-500" />
                        <SmallTotal label="PAYPAL TOTAL" value={totals.totalPaypal} color="text-purple-500" />
                      </div>
                    </div>
                  </div>
                </div>

                {canEdit && (
                  <div className="p-12 bg-slate-50 border-b-4">
                    <MainEntryForm onAdd={addMainEntry} />
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left table-fixed min-w-[1300px]">
                    <thead className="bg-slate-100 text-[11px] font-black text-slate-500 uppercase tracking-[0.2em] border-b-4">
                      <tr>
                        <th className="px-12 py-7 w-32">ROOM</th>
                        <th className="px-12 py-7 w-2/5">DESCRIPTIONS (WIDE)</th>
                        <th className="px-12 py-7 w-40 text-center">PAYMENT</th>
                        <th className="px-12 py-7 w-52 text-right">CASH IN</th>
                        <th className="px-12 py-7 w-52 text-right">CASH OUT</th>
                        {canEdit && <th className="px-12 py-7 w-24 text-center">DEL</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-slate-100">
                      {openingBalance !== 0 && (
                        <tr className="bg-emerald-50/50">
                          <td className="px-12 py-10 font-black text-emerald-800 text-xl underline decoration-double">OPEN</td>
                          <td className="px-12 py-10 font-black text-emerald-950 uppercase italic tracking-wider">BALANCE BROUGHT FORWARD</td>
                          <td className="px-12 py-10 text-center"><MethodBadge method={PaymentMethod.CASH} /></td>
                          <td className="px-12 py-10 text-right font-black text-emerald-600 text-3xl">Rs. {openingBalance.toLocaleString()}</td>
                          <td className="px-12 py-10 text-right text-slate-300 font-black">-</td>
                          {canEdit && <td></td>}
                        </tr>
                      )}
                      {(mainEntries as MainEntry[]).map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-all">
                          <td className="px-12 py-10 font-black text-slate-950 text-2xl">{e.roomNo || '--'}</td>
                          <td className="px-12 py-10 font-black text-slate-800 text-xl leading-relaxed">{e.description}</td>
                          <td className="px-12 py-10 text-center"><MethodBadge method={e.method} /></td>
                          <td className="px-12 py-10 text-right font-black text-blue-700 text-3xl">
                             {e.cashIn > 0 ? `Rs. ${e.cashIn.toLocaleString()}` : '-'}
                          </td>
                          <td className="px-12 py-10 text-right font-black text-red-700 text-3xl">
                             {e.cashOut > 0 ? `Rs. ${e.cashOut.toLocaleString()}` : '-'}
                          </td>
                          {canEdit && (
                            <td className="px-12 py-10 text-center">
                              <button onClick={() => removeMainEntry(e.id)} className="text-red-300 hover:text-red-700 font-black text-5xl">&times;</button>
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
                    className="bg-red-700 text-white px-32 py-10 rounded-[4rem] font-black text-2xl uppercase tracking-[0.4em] shadow-[0_25px_50px_-12px_rgba(185,28,28,0.5)] hover:bg-red-800 active:scale-95 transition-all border-b-8 border-red-900"
                  >
                    CLOSE TODAY'S BOOK
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      )}

      {/* QR Pairing Overlay */}
      {showQr && (
        <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-xl z-[100] flex items-center justify-center p-6 animate-in zoom-in duration-300">
           <div className="bg-white p-12 md:p-20 rounded-[5rem] max-w-lg w-full text-center space-y-10 shadow-[0_0_100px_rgba(37,99,235,0.3)]">
              <h2 className="text-4xl font-black text-blue-900 uppercase tracking-tighter">Pair Mobile Device</h2>
              <div className="bg-white p-8 rounded-3xl border-4 border-slate-100 flex justify-center mx-auto shadow-inner">
                 <QRCodeSVG value={viewerUrl} size={300} level="H" includeMargin />
              </div>
              <p className="text-slate-500 font-bold text-lg">Scan this code with your Android or iPhone to instantly sync the live book.</p>
              <button 
                onClick={() => setShowQr(false)}
                className="w-full bg-slate-900 text-white py-6 rounded-3xl font-black uppercase tracking-widest text-xl hover:bg-black"
              >
                Close QR Code
              </button>
           </div>
        </div>
      )}
    </div>
  );
};

// --- Atomic Components ---

const RateBox = ({ label, value, icon }: { label: string, value: number, icon: string }) => (
  <div className="bg-white border-4 border-slate-100 px-6 py-3 rounded-3xl flex flex-col items-center min-w-[140px] shadow-sm">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{icon} {label} / LKR</span>
    <span className="text-2xl font-black text-blue-950">Rs. {value}</span>
  </div>
);

const StatPill = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className={`${color} px-8 py-5 rounded-3xl text-white shadow-2xl min-w-[200px] text-center border-b-4 border-black/20`}>
    <p className="text-[10px] font-black opacity-70 uppercase tracking-widest mb-1">{label}</p>
    <p className="text-2xl font-black">Rs. {value.toLocaleString()}</p>
  </div>
);

const TotalCard = ({ label, value, color, highlight = false }: { label: string, value: number, color: string, highlight?: boolean }) => (
  <div className={`px-10 py-8 rounded-[2.5rem] bg-white/5 border-4 flex flex-col items-center justify-center ${highlight ? 'bg-green-500/10 border-green-500/50 ring-8 ring-green-500/5' : 'border-white/10'}`}>
    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">{label} TOTAL</span>
    <span className={`text-4xl font-black ${color}`}>Rs. {value.toLocaleString()}</span>
  </div>
);

const SmallTotal = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className="flex justify-between items-center bg-slate-800/50 px-6 py-3.5 rounded-2xl border border-white/10">
    <span className={`text-[10px] font-black ${color} tracking-[0.2em]`}>{label}</span>
    <span className="text-lg font-black text-white ml-6">Rs.{value.toLocaleString()}</span>
  </div>
);

const MethodBadge = ({ method }: { method: PaymentMethod }) => {
  const styles = {
    [PaymentMethod.CASH]: "bg-blue-100 text-blue-800 border-blue-300",
    [PaymentMethod.CARD]: "bg-amber-100 text-amber-900 border-amber-400",
    [PaymentMethod.PAYPAL]: "bg-purple-100 text-purple-900 border-purple-400",
  };
  return (
    <span className={`${styles[method]} border-2 px-6 py-2.5 rounded-full text-[11px] font-black uppercase tracking-widest shadow-sm`}>
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
    <form className="flex flex-wrap items-end gap-8" onSubmit={submit}>
      <div className="flex-1 min-w-[240px]">
        <label className="block text-xs font-black text-slate-600 mb-3 uppercase tracking-widest">Entry Payment Mode</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full border-4 p-5 rounded-3xl font-black text-xl appearance-none bg-white">
          <option value={PaymentMethod.CASH}>CASH</option>
          <option value={PaymentMethod.CARD}>CARD</option>
          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="flex-[2] min-w-[350px]">
        <label className="block text-xs font-black text-slate-600 mb-3 uppercase tracking-widest">Amount (Rs)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border-4 p-5 rounded-3xl font-black text-3xl placeholder-slate-200" placeholder="0.00" />
      </div>
      <button type="submit" className="px-16 py-7 bg-blue-700 text-white font-black rounded-3xl hover:bg-blue-800 shadow-2xl uppercase text-sm tracking-[0.2em] transition-all active:scale-95 border-b-8 border-blue-900">Add Out Party Entry</button>
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
    <form className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end" onSubmit={submit}>
      <div className="lg:col-span-1">
        <label className="block text-[11px] font-black text-slate-500 mb-3 uppercase tracking-widest">Room</label>
        <input type="text" value={room} onChange={(e) => setRoom(e.target.value)} className="w-full border-4 p-5 rounded-3xl font-black text-center text-xl" placeholder="#" />
      </div>
      <div className="lg:col-span-4">
        <label className="block text-[11px] font-black text-slate-500 mb-3 uppercase tracking-widest">Description (Broad Detail)</label>
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full border-4 p-5 rounded-3xl font-black text-xl" placeholder="Guest name, invoice details..." required />
      </div>
      <div className="lg:col-span-2">
        <label className="block text-[11px] font-black text-slate-500 mb-3 uppercase tracking-widest">Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full border-4 p-5 rounded-3xl font-black text-xl bg-white">
          <option value={PaymentMethod.CASH}>CASH</option>
          <option value={PaymentMethod.CARD}>CARD</option>
          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="lg:col-span-2">
        <label className="block text-[11px] font-black text-blue-700 mb-3 uppercase tracking-widest">Cash In</label>
        <input type="number" value={cashIn} onChange={(e) => setCashIn(e.target.value)} className="w-full border-4 p-5 rounded-3xl font-black text-blue-800 text-xl" placeholder="0" />
      </div>
      <div className="lg:col-span-2">
        <label className="block text-[11px] font-black text-red-700 mb-3 uppercase tracking-widest">Cash Out</label>
        <input type="number" value={cashOut} onChange={(e) => setCashOut(e.target.value)} className="w-full border-4 p-5 rounded-3xl font-black text-red-800 text-xl" placeholder="0" />
      </div>
      <div className="lg:col-span-1">
        <button type="submit" className="w-full h-[76px] bg-slate-900 text-white rounded-3xl font-black text-xs hover:bg-black uppercase tracking-widest shadow-2xl border-b-4 border-black">ADD</button>
      </div>
    </form>
  );
};

const SyncSetup = ({ onSet }: { onSet: (id: string) => void }) => {
  const [val, setVal] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[100] flex items-center justify-center p-6">
      <div className="bg-white p-16 md:p-24 rounded-[5rem] shadow-[0_0_150px_-20px_rgba(30,58,138,0.5)] max-w-2xl w-full text-center space-y-12 animate-in zoom-in duration-500">
        <div className="space-y-4">
          <h2 className="text-6xl font-black text-blue-900 tracking-tighter uppercase leading-none">MESH PAIRING</h2>
          <p className="text-slate-500 font-bold text-xl">Create or join a secure live book instance.</p>
        </div>
        <div className="space-y-8">
          <input 
            type="text" 
            value={val} 
            onChange={(e) => setVal(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter' && val) onSet(val.trim()); }}
            className="w-full p-12 bg-slate-100 rounded-[3rem] border-8 border-slate-200 font-black text-5xl text-center outline-none focus:border-blue-600 transition-all uppercase tracking-widest shadow-inner"
            placeholder="SHIVAS-ID"
          />
          <button 
            onClick={() => val && onSet(val.trim())}
            className="w-full p-12 bg-blue-700 text-white font-black rounded-[3rem] text-3xl hover:bg-blue-800 shadow-2xl active:scale-95 transition-all uppercase tracking-[0.3em] border-b-[12px] border-blue-900"
          >
            Connect Book
          </button>
        </div>
        <div className="bg-blue-50 p-10 rounded-[2.5rem] border-4 border-blue-100">
           <p className="text-sm font-black text-blue-700 uppercase tracking-widest leading-relaxed">
             Ultra-Performance Sync is Active.<br/>
             All devices will link instantly through our global mesh relay nodes.
           </p>
        </div>
      </div>
    </div>
  );
};

const ArchiveView = ({ history }: { history: HistoryRecord[] }) => (
  <div className="space-y-12 animate-in fade-in slide-in-from-bottom duration-700">
    <h2 className="text-5xl font-black text-slate-900 uppercase tracking-[0.4em] border-l-[24px] border-slate-900 pl-12 leading-none">THE ARCHIVES</h2>
    <div className="grid gap-10">
      {history.length === 0 ? (
        <div className="p-40 bg-white rounded-[5rem] border-8 border-dashed border-slate-200 text-center text-slate-300 font-black uppercase tracking-[0.3em] italic text-3xl">Empty Archive</div>
      ) : (
        history.map((h, i) => (
          <div key={i} className="bg-white p-16 rounded-[4rem] shadow-2xl border-4 border-slate-100 flex flex-col md:flex-row justify-between items-center gap-12 group hover:border-blue-500 transition-all">
            <div className="text-center md:text-left">
               <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Closing Timestamp</p>
               <p className="text-5xl font-black text-slate-900 tracking-tighter">{h.date}</p>
            </div>
            <div className="flex gap-24">
              <div className="text-center">
                 <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Total Net Balance</p>
                 <p className="text-5xl font-black text-emerald-600 tracking-tighter">Rs. {h.finalBalance.toLocaleString()}</p>
              </div>
            </div>
            <button className="px-16 py-7 bg-slate-900 text-white font-black rounded-[2.5rem] hover:bg-black transition-all uppercase text-sm tracking-widest shadow-2xl group-hover:scale-105 active:scale-95">View Report</button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default App;
