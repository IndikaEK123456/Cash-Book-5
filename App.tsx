
import React, { useState, useEffect, useMemo } from 'react';
import Gun from 'gun';
import { QRCodeSVG } from 'qrcode.react';
import { PaymentMethod, DeviceType, OutPartyEntry, MainEntry, HistoryRecord } from './types';
import { fetchExchangeRates } from './services/geminiService';

/**
 * HIGH-PERFORMANCE GLOBAL MESH
 * Using diverse nodes to ensure connectivity regardless of local ISP firewalls.
 */
const MESH_RELAYS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us.herokuapp.com/gun',
  'https://peer.wall.org/gun',
  'https://gunjs.herokuapp.com/gun',
  'https://dweb.link/gun',
  'https://relay.p2p.legal/gun'
];

// Initialize Gun with production settings
const gun = Gun({ peers: MESH_RELAYS, localStorage: true });

const App: React.FC = () => {
  // --- Core State ---
  const [device, setDevice] = useState<DeviceType>(DeviceType.LAPTOP);
  const [syncId, setSyncId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('sid') || localStorage.getItem('shivas_sync_id') || '';
  });
  const [isReady, setIsReady] = useState(false);

  // --- Real-Time Ledger State ---
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [outPartyMap, setOutPartyMap] = useState<Record<string, OutPartyEntry>>({});
  const [mainEntryMap, setMainEntryMap] = useState<Record<string, MainEntry>>({});
  const [historyList, setHistoryList] = useState<HistoryRecord[]>([]);
  const [rates, setRates] = useState({ usd: 310, eur: 335 });
  
  // --- App Lifecycle State ---
  const [viewHistory, setViewHistory] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [peerActive, setPeerActive] = useState(false);

  // --- Derived Typed Collections ---
  const outPartyEntries = useMemo(() => 
    (Object.values(outPartyMap) as OutPartyEntry[]).sort((a, b) => a.index - b.index), 
  [outPartyMap]);

  const mainEntries = useMemo(() => 
    Object.values(mainEntryMap) as MainEntry[], 
  [mainEntryMap]);

  // --- Calculations (Requirement 13, 14, 15) ---
  const totals = useMemo(() => {
    const opCash = outPartyEntries.filter(e => e.method === PaymentMethod.CASH).reduce((s, e) => s + (e.amount || 0), 0);
    const opCard = outPartyEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.amount || 0), 0);
    const opPaypal = outPartyEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.amount || 0), 0);

    const mCashIn = mainEntries.reduce((s, e) => s + (e.cashIn || 0), 0);
    const mCashOut = mainEntries.reduce((s, e) => s + (e.cashOut || 0), 0);
    
    const mCardIn = mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.cashIn || 0), 0);
    const mPaypalIn = mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.cashIn || 0), 0);

    // Total collections across both sections
    const totalCard = opCard + mCardIn;
    const totalPaypal = opPaypal + mPaypalIn;

    // Financial balancing logic
    const totalCashIn = openingBalance + mCashIn + opCash + opCard + opPaypal;
    const totalCashOut = mCashOut + totalCard + totalPaypal;

    return {
      opCash, opCard, opPaypal,
      totalCard, totalPaypal,
      totalCashIn, totalCashOut,
      balance: totalCashIn - totalCashOut
    };
  }, [outPartyEntries, mainEntries, openingBalance]);

  // --- App Initialization ---
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    const ua = navigator.userAgent;
    if (Object.values(DeviceType).includes(hash as DeviceType)) setDevice(hash as DeviceType);
    else if (/Android/i.test(ua)) setDevice(DeviceType.ANDROID);
    else if (/iPhone|iPad|iPod/i.test(ua)) setDevice(DeviceType.IPHONE);
    else setDevice(DeviceType.LAPTOP);

    fetchExchangeRates().then(setRates);
    setIsReady(true);

    if (new URLSearchParams(window.location.search).get('sid')) {
      localStorage.setItem('shivas_sync_id', new URLSearchParams(window.location.search).get('sid')!);
    }
  }, []);

  /**
   * ROBUST SYNC ENGINE
   * Listens for changes and forces typing on Gun input.
   */
  useEffect(() => {
    if (!syncId) return;
    const db = gun.get('shivas_ledger_v7').get(syncId);

    // Sync pulse for visual feedback
    const pulseTimer = setInterval(() => {
      if (device === DeviceType.LAPTOP) db.get('pulse').put(Date.now());
    }, 4000);

    db.get('pulse').on((p) => {
      setPeerActive(true);
      setTimeout(() => setPeerActive(false), 5000);
    });

    db.get('balance').on((v) => {
      if (v !== undefined) setOpeningBalance(parseFloat(v as string));
    });

    db.get('outParty').map().on((data, id) => {
      if (data === null) {
        setOutPartyMap(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        setOutPartyMap(prev => ({ ...prev, [id]: JSON.parse(data as string) }));
      }
    });

    db.get('main').map().on((data, id) => {
      if (data === null) {
        setMainEntryMap(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        setMainEntryMap(prev => ({ ...prev, [id]: JSON.parse(data as string) }));
      }
    });

    db.get('history').on((data) => {
      if (data) setHistoryList(JSON.parse(data as string));
    });

    return () => { 
      db.off(); 
      clearInterval(pulseTimer);
    };
  }, [syncId, device]);

  // --- Transaction Handlers ---
  const isEditor = device === DeviceType.LAPTOP;

  const addOutParty = (method: PaymentMethod, amount: number) => {
    if (!isEditor || !syncId) return;
    const id = crypto.randomUUID();
    const entry: OutPartyEntry = { id, index: outPartyEntries.length + 1, method, amount };
    gun.get('shivas_ledger_v7').get(syncId).get('outParty').get(id).put(JSON.stringify(entry));
  };

  const removeOutParty = (id: string) => {
    if (!isEditor || !syncId) return;
    gun.get('shivas_ledger_v7').get(syncId).get('outParty').get(id).put(null);
  };

  const addMainEntry = (roomNo: string, description: string, method: PaymentMethod, cashIn: number, cashOut: number) => {
    if (!isEditor || !syncId) return;
    const id = crypto.randomUUID();
    const entry: MainEntry = { id, roomNo, description, method, cashIn, cashOut };
    gun.get('shivas_ledger_v7').get(syncId).get('main').get(id).put(JSON.stringify(entry));
  };

  const removeMainEntry = (id: string) => {
    if (!isEditor || !syncId) return;
    gun.get('shivas_ledger_v7').get(syncId).get('main').get(id).put(null);
  };

  const closeDailyBook = () => {
    if (!isEditor || !syncId) return;
    if (!confirm("Finalize today's book? The balance will become tomorrow's start.")) return;

    const record: HistoryRecord = {
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

    const db = gun.get('shivas_ledger_v7').get(syncId);
    outPartyEntries.forEach(e => db.get('outParty').get(e.id).put(null));
    mainEntries.forEach(e => db.get('main').get(e.id).put(null));
    db.get('balance').put(totals.balance.toString());
    db.get('history').put(JSON.stringify([record, ...historyList]));
  };

  // --- UI QR Setup ---
  const qrUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}?sid=${syncId}#${DeviceType.ANDROID}`;
  }, [syncId]);

  if (!isReady) return null;

  // Block editor mode on unauthorized mobile devices
  if (device === DeviceType.LAPTOP && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return (
      <div className="h-screen bg-slate-900 flex flex-col items-center justify-center p-12 text-center text-white">
        <div className="bg-red-600/10 border-4 border-red-600 p-12 rounded-[4rem] max-w-xl space-y-8">
          <h2 className="text-5xl font-black uppercase tracking-tighter">Access Locked</h2>
          <p className="text-xl font-bold text-slate-300">Laptop Editor mode is not allowed on mobile hardware. Please use your device in Viewer mode.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-48">
      {/* Universal Sticky Header */}
      <header className="bg-white border-b-8 border-slate-900 sticky top-0 z-[100] shadow-2xl px-6 py-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="text-center md:text-left">
            <h1 className="text-5xl md:text-6xl font-black text-slate-900 tracking-tighter uppercase leading-none">SHIVAS BEACH CABANAS</h1>
            <div className="flex items-center justify-center md:justify-start gap-5 mt-3">
              <span className="text-[12px] font-black text-slate-400 uppercase tracking-[0.4em]">{new Date().toDateString()}</span>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${peerActive ? 'bg-blue-600 sync-pulse' : 'bg-slate-200'}`}></div>
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">
                  {device === DeviceType.LAPTOP ? 'Relay Active' : 'Live Sync Feed'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <RateBadge label="USD" value={rates.usd} flag="🇺🇸" />
            <RateBadge label="EUR" value={rates.eur} flag="🇪🇺" />
            {isEditor && (
              <button onClick={() => setShowQr(true)} className="bg-slate-900 text-white p-5 rounded-[2rem] hover:bg-blue-700 transition-all shadow-xl active:scale-90">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {!syncId ? (
        <SyncGate onConnect={(id) => { setSyncId(id); localStorage.setItem('shivas_sync_id', id); }} />
      ) : (
        <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-16">
          
          <div className="flex justify-between items-center bg-white border-4 border-slate-900 p-8 rounded-[3rem] shadow-2xl">
            <div className="flex items-center gap-6">
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Digital Vault ID:</span>
              <span className="text-3xl font-black text-blue-700 tracking-[0.2em] select-all">{syncId}</span>
            </div>
            <button onClick={() => setViewHistory(!viewHistory)} className="bg-slate-900 text-white px-10 py-5 rounded-full font-black text-xs uppercase tracking-widest hover:bg-blue-900 transition-all shadow-xl">
              {viewHistory ? 'Live Book' : 'Archives'}
            </button>
          </div>

          {viewHistory ? (
            <HistoryView history={historyList} />
          ) : (
            <div className="space-y-16 animate-in fade-in duration-700">
              
              {/* Out Party Section */}
              <section className="bg-white rounded-[4rem] shadow-2xl border-4 border-slate-900 overflow-hidden">
                <div className="bg-blue-700 p-12 flex flex-col md:flex-row justify-between items-center gap-10">
                  <h2 className="text-4xl font-black text-white uppercase tracking-[0.3em]">OUT PARTY BOOK</h2>
                  <div className="flex flex-wrap justify-center gap-6">
                    <SummaryPill label="CASH" value={totals.opCash} color="bg-blue-900" />
                    <SummaryPill label="CARD" value={totals.opCard} color="bg-amber-500" />
                    <SummaryPill label="PAYPAL" value={totals.opPaypal} color="bg-purple-600" />
                  </div>
                </div>
                {isEditor && <div className="p-10 bg-blue-50/50 border-b-4 border-blue-100"><OutForm onAdd={addOutParty} /></div>}
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-100 border-b-4 border-slate-900/10">
                      <tr>
                        <th className="px-12 py-8 text-xs font-black text-slate-500 uppercase tracking-widest w-24 text-center">No</th>
                        <th className="px-12 py-8 text-xs font-black text-slate-500 uppercase tracking-widest">Payment Method</th>
                        <th className="px-12 py-8 text-xs font-black text-slate-500 uppercase tracking-widest text-right">Amount (LKR)</th>
                        {isEditor && <th className="px-12 py-8 w-24"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-slate-100">
                      {outPartyEntries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-12 py-8 text-center font-black text-slate-300 text-2xl">{e.index}</td>
                          <td className="px-12 py-8"><MethodBadge method={e.method} /></td>
                          <td className="px-12 py-8 text-right font-black text-4xl text-slate-900">Rs. {e.amount.toLocaleString()}</td>
                          {isEditor && <td className="px-12 py-8 text-center"><button onClick={() => removeOutParty(e.id)} className="text-red-300 hover:text-red-600 font-black text-5xl">&times;</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Main Ledger Section */}
              <section className="bg-white rounded-[4rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.4)] border-4 border-slate-900 overflow-hidden">
                <div className="bg-slate-900 p-14">
                  <div className="flex flex-col lg:flex-row justify-between items-center gap-12">
                    <h2 className="text-5xl font-black text-white uppercase tracking-[0.4em]">MAIN LEDGER</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-8 w-full lg:w-auto">
                      <MasterCard label="CASH IN" value={totals.totalCashIn} color="text-blue-400" />
                      <MasterCard label="CASH OUT" value={totals.totalCashOut} color="text-red-400" />
                      <MasterCard label="NET BAL" value={totals.balance} color="text-green-400" highlight />
                      <div className="flex flex-col gap-4">
                        <SmallStat label="CARD TOTAL" value={totals.totalCard} color="text-amber-500" />
                        <SmallStat label="PAYPAL TOTAL" value={totals.totalPaypal} color="text-purple-500" />
                      </div>
                    </div>
                  </div>
                </div>
                {isEditor && <div className="p-12 bg-slate-50 border-b-4 border-slate-200"><MainForm onAdd={addMainEntry} /></div>}
                <div className="overflow-x-auto">
                  <table className="w-full text-left table-fixed min-w-[1300px]">
                    <thead className="bg-slate-100 text-[11px] font-black text-slate-500 uppercase tracking-[0.3em] border-b-4 border-slate-900/10">
                      <tr>
                        <th className="px-14 py-8 w-32">ROOM</th>
                        <th className="px-14 py-8 w-2/5">GUEST / DESCRIPTION</th>
                        <th className="px-14 py-8 w-40 text-center">MODE</th>
                        <th className="px-14 py-8 w-56 text-right">IN (Rs)</th>
                        <th className="px-14 py-8 w-56 text-right">OUT (Rs)</th>
                        {isEditor && <th className="px-14 py-8 w-24"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-slate-100">
                      {openingBalance !== 0 && (
                        <tr className="bg-emerald-50/50">
                          <td className="px-14 py-12 font-black text-emerald-800 text-3xl">OPEN</td>
                          <td className="px-14 py-12 font-black text-emerald-950 uppercase italic tracking-widest text-xl">BALANCE BROUGHT FORWARD</td>
                          <td className="px-14 py-12 text-center"><MethodBadge method={PaymentMethod.CASH} /></td>
                          <td className="px-14 py-12 text-right font-black text-emerald-600 text-4xl">Rs. {openingBalance.toLocaleString()}</td>
                          <td className="px-14 py-12 text-right text-slate-300 font-black">-</td>
                          {isEditor && <td></td>}
                        </tr>
                      )}
                      {mainEntries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-all">
                          <td className="px-14 py-12 font-black text-slate-950 text-3xl">{e.roomNo || '--'}</td>
                          <td className="px-14 py-12 font-black text-slate-800 text-2xl leading-relaxed">{e.description}</td>
                          <td className="px-14 py-12 text-center"><MethodBadge method={e.method} /></td>
                          <td className="px-14 py-12 text-right font-black text-blue-700 text-4xl">
                             {e.cashIn > 0 ? `Rs. ${e.cashIn.toLocaleString()}` : '-'}
                          </td>
                          <td className="px-14 py-12 text-right font-black text-red-700 text-4xl">
                             {e.cashOut > 0 ? `Rs. ${e.cashOut.toLocaleString()}` : '-'}
                          </td>
                          {isEditor && <td className="px-14 py-12 text-center"><button onClick={() => removeMainEntry(e.id)} className="text-red-200 hover:text-red-700 font-black text-6xl transition-all">&times;</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {isEditor && (
                <div className="flex justify-center pt-12">
                  <button onClick={closeDailyBook} className="bg-red-700 text-white px-40 py-12 rounded-[5rem] font-black text-3xl uppercase tracking-[0.4em] shadow-2xl hover:bg-red-800 active:scale-95 transition-all border-b-[12px] border-red-950">
                    CLOSE DAILY BOOK
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      )}

      {/* Pairing Overlay */}
      {showQr && (
        <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[150] flex items-center justify-center p-8 animate-in zoom-in duration-300">
          <div className="bg-white p-20 rounded-[6rem] max-w-2xl w-full text-center space-y-12 shadow-[0_0_150px_rgba(37,99,235,0.5)]">
            <h2 className="text-5xl font-black text-slate-900 uppercase tracking-tighter">Pair Mobile Device</h2>
            <div className="bg-white p-10 rounded-[4rem] border-8 border-slate-50 flex justify-center mx-auto shadow-inner">
              <QRCodeSVG value={qrUrl} size={320} level="H" includeMargin />
            </div>
            <p className="text-slate-500 font-bold text-2xl leading-snug">Scan this code with your iPhone or Android camera to instantly link the live ledger.</p>
            <button onClick={() => setShowQr(false)} className="w-full bg-slate-900 text-white py-8 rounded-[3rem] font-black uppercase tracking-widest text-2xl hover:bg-black transition-all border-b-8 border-black">Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Atomic Layout Components ---

const RateBadge = ({ label, value, flag }: { label: string, value: number, flag: string }) => (
  <div className="bg-slate-50 border-4 border-slate-100 px-7 py-3.5 rounded-[2rem] flex flex-col items-center min-w-[150px] shadow-sm">
    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">{flag} {label}</span>
    <span className="text-2xl font-black text-slate-950">Rs. {value}</span>
  </div>
);

const SummaryPill = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className={`${color} px-10 py-6 rounded-[2.5rem] text-white shadow-2xl min-w-[200px] text-center border-b-4 border-black/30`}>
    <p className="text-[10px] font-black opacity-70 uppercase tracking-widest mb-1">{label} TOTAL</p>
    <p className="text-3xl font-black">Rs. {value.toLocaleString()}</p>
  </div>
);

const MasterCard = ({ label, value, color, highlight = false }: { label: string, value: number, color: string, highlight?: boolean }) => (
  <div className={`px-12 py-10 rounded-[4rem] bg-white/5 border-4 flex flex-col items-center justify-center ${highlight ? 'bg-green-500/15 border-green-500/60 ring-[20px] ring-green-500/5' : 'border-white/10'}`}>
    <span className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-3">{label}</span>
    <span className={`text-5xl font-black ${color}`}>Rs. {value.toLocaleString()}</span>
  </div>
);

const SmallStat = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className="flex justify-between items-center bg-slate-800/70 px-8 py-4 rounded-[1.5rem] border border-white/5 shadow-inner">
    <span className={`text-[11px] font-black ${color} tracking-[0.2em]`}>{label}</span>
    <span className="text-xl font-black text-white ml-6">Rs.{value.toLocaleString()}</span>
  </div>
);

const MethodBadge = ({ method }: { method: PaymentMethod }) => {
  const styles = {
    [PaymentMethod.CASH]: "bg-blue-50 text-blue-700 border-blue-200",
    [PaymentMethod.CARD]: "bg-amber-50 text-amber-800 border-amber-300",
    [PaymentMethod.PAYPAL]: "bg-purple-50 text-purple-800 border-purple-300",
  };
  return <span className={`${styles[method]} border-2 px-7 py-3 rounded-full text-[12px] font-black uppercase tracking-widest shadow-sm`}>{method}</span>;
};

const OutForm = ({ onAdd }: { onAdd: (m: PaymentMethod, a: number) => void }) => {
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [amount, setAmount] = useState('');
  return (
    <form className="flex flex-wrap items-end gap-8" onSubmit={e => { e.preventDefault(); onAdd(method, parseFloat(amount)); setAmount(''); }}>
      <div className="flex-1 min-w-[250px]">
        <label className="block text-xs font-black text-slate-500 mb-3 uppercase tracking-widest">Entry Type</label>
        <select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} className="w-full border-4 p-5 rounded-[2rem] font-black text-xl appearance-none bg-white">
          <option value={PaymentMethod.CASH}>CASH</option><option value={PaymentMethod.CARD}>CARD</option><option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="flex-[2] min-w-[350px]">
        <label className="block text-xs font-black text-slate-500 mb-3 uppercase tracking-widest">Amount (Rs)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border-4 p-5 rounded-[2rem] font-black text-3xl placeholder-slate-200" placeholder="0.00" required />
      </div>
      <button type="submit" className="px-16 py-6 bg-blue-700 text-white font-black rounded-[2rem] hover:bg-blue-800 shadow-xl uppercase text-sm tracking-widest transition-all border-b-8 border-blue-950">Add Entry</button>
    </form>
  );
};

const MainForm = ({ onAdd }: { onAdd: (r: string, d: string, m: PaymentMethod, ci: number, co: number) => void }) => {
  const [room, setRoom] = useState('');
  const [desc, setDesc] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [ci, setCi] = useState('');
  const [co, setCo] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); onAdd(room, desc, method, parseFloat(ci || '0'), parseFloat(co || '0'));
    setRoom(''); setDesc(''); setCi(''); setCo('');
  };
  return (
    <form className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end" onSubmit={submit}>
      <div className="lg:col-span-1"><input value={room} onChange={e => setRoom(e.target.value)} className="w-full border-4 p-5 rounded-[1.5rem] font-black text-center text-xl" placeholder="RM#" /></div>
      <div className="lg:col-span-4"><input value={desc} onChange={e => setDesc(e.target.value)} className="w-full border-4 p-5 rounded-[1.5rem] font-black text-xl" placeholder="Detailed description..." required /></div>
      <div className="lg:col-span-2"><select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} className="w-full border-4 p-5 rounded-[1.5rem] font-black text-xl bg-white">
        <option value={PaymentMethod.CASH}>CASH</option><option value={PaymentMethod.CARD}>CARD</option><option value={PaymentMethod.PAYPAL}>PAY PAL</option>
      </select></div>
      <div className="lg:col-span-2"><input type="number" value={ci} onChange={e => setCi(e.target.value)} className="w-full border-4 p-5 rounded-[1.5rem] font-black text-blue-700 text-xl" placeholder="IN" /></div>
      <div className="lg:col-span-2"><input type="number" value={co} onChange={e => setCo(e.target.value)} className="w-full border-4 p-5 rounded-[1.5rem] font-black text-red-700 text-xl" placeholder="OUT" /></div>
      <div className="lg:col-span-1"><button type="submit" className="w-full h-[76px] bg-slate-900 text-white rounded-[1.5rem] font-black text-xs hover:bg-black uppercase border-b-8 border-black shadow-2xl">ADD</button></div>
    </form>
  );
};

const SyncGate = ({ onConnect }: { onConnect: (id: string) => void }) => {
  const [id, setId] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[200] flex items-center justify-center p-8">
      <div className="bg-white p-20 md:p-32 rounded-[6rem] shadow-[0_0_200px_-50px_rgba(30,58,138,0.7)] max-w-3xl w-full text-center space-y-16 animate-in zoom-in duration-500">
        <h2 className="text-7xl font-black text-slate-900 tracking-tighter uppercase leading-none">MESH PROTOCOL</h2>
        <div className="space-y-10">
          <input value={id} onChange={e => setId(e.target.value.toUpperCase())} className="w-full p-16 bg-slate-100 rounded-[4rem] border-8 border-slate-200 font-black text-6xl text-center outline-none focus:border-blue-600 transition-all uppercase tracking-[0.3em] shadow-inner" placeholder="VAULT-ID" />
          <button onClick={() => id && onConnect(id.trim())} className="w-full p-16 bg-blue-700 text-white font-black rounded-[4rem] text-4xl hover:bg-blue-800 shadow-2xl active:scale-95 transition-all uppercase tracking-[0.4em] border-b-[16px] border-blue-950">Pair Systems</button>
        </div>
        <p className="text-xl font-black text-blue-600 uppercase tracking-widest opacity-60">High-Performance Decentralized Sync Active</p>
      </div>
    </div>
  );
};

const HistoryView = ({ history }: { history: HistoryRecord[] }) => (
  <div className="space-y-12 animate-in fade-in slide-in-from-bottom duration-700">
    <h2 className="text-6xl font-black text-slate-900 uppercase tracking-widest border-l-[30px] border-slate-900 pl-16 leading-none">LEDGER HISTORY</h2>
    <div className="grid gap-12">
      {history.length === 0 ? (
        <div className="p-60 bg-white rounded-[6rem] border-8 border-dashed border-slate-200 text-center text-slate-300 font-black uppercase tracking-[0.4em] italic text-4xl">Archive Empty</div>
      ) : (
        history.map((h, i) => (
          <div key={i} className="bg-white p-20 rounded-[5rem] shadow-2xl border-4 border-slate-100 flex flex-col md:flex-row justify-between items-center gap-16 group hover:border-blue-600 transition-all cursor-default">
            <div className="text-center md:text-left">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-5">Settlement Date</p>
              <p className="text-6xl font-black text-slate-900 tracking-tighter">{h.date}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-5">Closing Net Balance</p>
              <p className="text-6xl font-black text-emerald-600 tracking-tighter">Rs. {h.finalBalance.toLocaleString()}</p>
            </div>
            <button className="px-20 py-8 bg-slate-900 text-white font-black rounded-[3rem] hover:bg-black transition-all uppercase text-sm tracking-widest shadow-2xl active:scale-95 border-b-8 border-black">View Details</button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default App;
