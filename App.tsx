
import React, { useState, useEffect, useMemo, useRef } from 'react';
import Gun from 'gun';
import { QRCodeSVG } from 'qrcode.react';
import { PaymentMethod, DeviceType, OutPartyEntry, MainEntry, HistoryRecord } from './types';
import { fetchExchangeRates } from './services/geminiService';

/**
 * HIGH-PERFORMANCE RELAY NETWORK
 * Explicitly chosen global nodes for max uptime.
 */
const MESH_RELAYS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us.herokuapp.com/gun',
  'https://peer.wall.org/gun',
  'https://gunjs.herokuapp.com/gun',
  'https://dweb.link/gun',
  'https://gun-ams.herokuapp.com/gun',
  'https://gun-sjc.herokuapp.com/gun',
  'https://relay.p2p.legal/gun'
];

const gun = Gun({ peers: MESH_RELAYS, localStorage: true });

const App: React.FC = () => {
  // --- Core State ---
  const [device, setDevice] = useState<DeviceType>(DeviceType.LAPTOP);
  const [syncId, setSyncId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('sid') || localStorage.getItem('shivas_sync_id') || '';
  });
  const [isReady, setIsReady] = useState(false);

  // --- Real-Time Ledger Data ---
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [outPartyMap, setOutPartyMap] = useState<Record<string, OutPartyEntry>>({});
  const [mainEntryMap, setMainEntryMap] = useState<Record<string, MainEntry>>({});
  const [historyList, setHistoryList] = useState<HistoryRecord[]>([]);
  const [rates, setRates] = useState({ usd: 310, eur: 335 });
  
  // --- App Logic State ---
  const [viewHistory, setViewHistory] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [lastPulse, setLastPulse] = useState<number>(Date.now());
  const [peerActive, setPeerActive] = useState(false);

  // --- Derived Collections ---
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

    // Requirement 14: Totals include both Out Party and Main Entry collections
    const totalCard = opCard + mCardIn;
    const totalPaypal = opPaypal + mPaypalIn;

    // Requirement 13 & 15: "Cash In" is everything collected. 
    // "Cash Out" accounts for both direct expenses AND non-cash balances being moved.
    const totalCashIn = openingBalance + mCashIn + opCash + opCard + opPaypal;
    const totalCashOut = mCashOut + totalCard + totalPaypal;

    return {
      opCash, opCard, opPaypal,
      totalCard, totalPaypal,
      totalCashIn, totalCashOut,
      balance: totalCashIn - totalCashOut
    };
  }, [outPartyEntries, mainEntries, openingBalance]);

  // --- Lifecycle & Auth ---
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
   * ADVANCED DELTA SYNC ENGINE
   */
  useEffect(() => {
    if (!syncId) return;
    const db = gun.get('shivas_ledger_v6').get(syncId);

    // Heartbeat for Peer Monitoring
    const heartbeat = setInterval(() => {
      if (device === DeviceType.LAPTOP) db.get('pulse').put(Date.now());
    }, 3000);

    db.get('pulse').on((p) => {
      setLastPulse(p as number);
      setPeerActive(true);
      setTimeout(() => setPeerActive(false), 4000);
    });

    db.get('balance').on((v) => v !== undefined && setOpeningBalance(parseFloat(v as string)));

    db.get('outParty').map().on((data, id) => {
      if (data === null) setOutPartyMap(p => { const n = {...p}; delete n[id]; return n; });
      else setOutPartyMap(p => ({ ...p, [id]: JSON.parse(data as string) }));
    });

    db.get('main').map().on((data, id) => {
      if (data === null) setMainEntryMap(p => { const n = {...p}; delete n[id]; return n; });
      else setMainEntryMap(p => ({ ...p, [id]: JSON.parse(data as string) }));
    });

    db.get('history').on((data) => data && setHistoryList(JSON.parse(data as string)));

    return () => { db.off(); clearInterval(heartbeat); };
  }, [syncId, device]);

  // --- Handlers ---
  const isEditor = device === DeviceType.LAPTOP;

  const addOutParty = (method: PaymentMethod, amount: number) => {
    if (!isEditor || !syncId) return;
    const id = crypto.randomUUID();
    const entry: OutPartyEntry = { id, index: outPartyEntries.length + 1, method, amount };
    gun.get('shivas_ledger_v6').get(syncId).get('outParty').get(id).put(JSON.stringify(entry));
  };

  const removeOutParty = (id: string) => {
    if (!isEditor || !syncId) return;
    gun.get('shivas_ledger_v6').get(syncId).get('outParty').get(id).put(null);
  };

  const addMainEntry = (roomNo: string, description: string, method: PaymentMethod, cashIn: number, cashOut: number) => {
    if (!isEditor || !syncId) return;
    const id = crypto.randomUUID();
    const entry: MainEntry = { id, roomNo, description, method, cashIn, cashOut };
    gun.get('shivas_ledger_v6').get(syncId).get('main').get(id).put(JSON.stringify(entry));
  };

  const removeMainEntry = (id: string) => {
    if (!isEditor || !syncId) return;
    gun.get('shivas_ledger_v6').get(syncId).get('main').get(id).put(null);
  };

  const closeBook = () => {
    if (!isEditor || !syncId) return;
    if (!confirm("Finalize today's book and move balance to tomorrow?")) return;

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

    const db = gun.get('shivas_ledger_v6').get(syncId);
    outPartyEntries.forEach(e => db.get('outParty').get(e.id).put(null));
    mainEntries.forEach(e => db.get('main').get(e.id).put(null));
    db.get('balance').put(totals.balance.toString());
    db.get('history').put(JSON.stringify([record, ...historyList]));
  };

  // --- UI Elements ---
  const qrUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}?sid=${syncId}#${DeviceType.ANDROID}`;
  }, [syncId]);

  if (!isReady) return null;

  // Requirement 4 check
  if (device === DeviceType.LAPTOP && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col items-center justify-center p-12 text-center">
        <div className="bg-red-500/10 border-2 border-red-500 p-10 rounded-[3rem] space-y-6 max-w-lg">
          <h2 className="text-4xl font-black text-red-500 uppercase tracking-tighter">Security Alert</h2>
          <p className="text-red-200 font-bold text-lg">Laptop management interface is locked on mobile devices. Please use the Viewer mode.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-40">
      {/* Dynamic Header */}
      <header className="bg-white border-b-8 border-slate-900 sticky top-0 z-[60] shadow-2xl px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tighter uppercase leading-none">SHIVAS BEACH CABANAS</h1>
            <div className="flex items-center justify-center md:justify-start gap-4 mt-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">{new Date().toDateString()}</span>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${peerActive ? 'bg-blue-500 sync-pulse' : 'bg-slate-300'}`}></div>
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  {device === DeviceType.LAPTOP ? 'Relay Broadcast Active' : 'Mesh Feed Connected'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <CurrencyChip label="USD" value={rates.usd} flag="🇺🇸" />
            <CurrencyChip label="EUR" value={rates.eur} flag="🇪🇺" />
            {isEditor && (
              <button onClick={() => setShowQr(true)} className="bg-slate-900 text-white p-4 rounded-3xl hover:bg-blue-600 transition-all shadow-lg active:scale-95">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {!syncId ? (
        <SyncOverlay onConnect={(id) => { setSyncId(id); localStorage.setItem('shivas_sync_id', id); }} />
      ) : (
        <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-12">
          
          <div className="flex justify-between items-center bg-white border-4 border-slate-900 p-6 rounded-[2.5rem] shadow-xl">
            <div className="flex items-center gap-4">
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Digital Vault:</span>
              <span className="text-2xl font-black text-blue-600 tracking-widest select-all">{syncId}</span>
            </div>
            <button onClick={() => setViewHistory(!viewHistory)} className="bg-slate-900 text-white px-8 py-4 rounded-full font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all">
              {viewHistory ? 'Live Ledger' : 'Archives'}
            </button>
          </div>

          {viewHistory ? (
            <ArchiveList history={historyList} />
          ) : (
            <div className="space-y-12 animate-in fade-in duration-1000">
              {/* Out Party Section */}
              <section className="bg-white rounded-[3.5rem] shadow-2xl border-4 border-slate-900 overflow-hidden">
                <div className="bg-blue-600 p-10 flex flex-col md:flex-row justify-between items-center gap-8">
                  <h2 className="text-3xl font-black text-white uppercase tracking-[0.2em]">OUT PARTY COLLECTIONS</h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    <PillStat label="CASH" value={totals.opCash} color="bg-blue-800" />
                    <PillStat label="CARD" value={totals.opCard} color="bg-amber-500" />
                    <PillStat label="PAYPAL" value={totals.opPaypal} color="bg-purple-600" />
                  </div>
                </div>
                {isEditor && <div className="p-8 bg-blue-50/50 border-b-4 border-blue-100"><OutEntryForm onAdd={addOutParty} /></div>}
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b-4 border-slate-100">
                      <tr>
                        <th className="px-10 py-6 text-xs font-black text-slate-400 uppercase tracking-widest w-24 text-center">#</th>
                        <th className="px-10 py-6 text-xs font-black text-slate-400 uppercase tracking-widest">Method</th>
                        <th className="px-10 py-6 text-xs font-black text-slate-400 uppercase tracking-widest text-right">Amount (LKR)</th>
                        {isEditor && <th className="px-10 py-6 w-24"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-slate-50">
                      {outPartyEntries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-10 py-6 text-center font-black text-slate-300 text-xl">{e.index}</td>
                          <td className="px-10 py-6"><MethodBadge method={e.method} /></td>
                          <td className="px-10 py-6 text-right font-black text-3xl text-slate-900">Rs. {e.amount.toLocaleString()}</td>
                          {isEditor && <td className="px-10 py-6 text-center"><button onClick={() => removeOutParty(e.id)} className="text-red-300 hover:text-red-600 font-black text-4xl">&times;</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {outPartyEntries.length === 0 && <div className="p-16 text-center text-slate-300 font-black uppercase italic text-xl">Waiting for entries...</div>}
                </div>
              </section>

              {/* Main Ledger Section */}
              <section className="bg-white rounded-[3.5rem] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.3)] border-4 border-slate-900 overflow-hidden">
                <div className="bg-slate-900 p-12">
                  <div className="flex flex-col lg:flex-row justify-between items-center gap-10">
                    <h2 className="text-4xl font-black text-white uppercase tracking-[0.3em]">MASTER LEDGER</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 w-full lg:w-auto">
                      <SummaryCard label="CASH IN" value={totals.totalCashIn} color="text-blue-400" />
                      <SummaryCard label="CASH OUT" value={totals.totalCashOut} color="text-red-400" />
                      <SummaryCard label="NET BALANCE" value={totals.balance} color="text-green-400" highlight />
                      <div className="flex flex-col gap-3">
                        <MiniStat label="CARD TOTAL" value={totals.totalCard} color="text-amber-500" />
                        <MiniStat label="PAYPAL TOTAL" value={totals.totalPaypal} color="text-purple-500" />
                      </div>
                    </div>
                  </div>
                </div>
                {isEditor && <div className="p-10 bg-slate-50 border-b-4 border-slate-100"><MainEntryForm onAdd={addMainEntry} /></div>}
                <div className="overflow-x-auto">
                  <table className="w-full text-left table-fixed min-w-[1300px]">
                    <thead className="bg-slate-50 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] border-b-4 border-slate-100">
                      <tr>
                        <th className="px-12 py-7 w-32">ROOM</th>
                        <th className="px-12 py-7 w-2/5">DESCRIPTION</th>
                        <th className="px-12 py-7 w-40 text-center">MODE</th>
                        <th className="px-12 py-7 w-52 text-right">IN (Rs)</th>
                        <th className="px-12 py-7 w-52 text-right">OUT (Rs)</th>
                        {isEditor && <th className="px-12 py-7 w-24"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-slate-50">
                      {openingBalance !== 0 && (
                        <tr className="bg-emerald-50/40">
                          <td className="px-12 py-10 font-black text-emerald-800 text-xl">OPEN</td>
                          <td className="px-12 py-10 font-black text-emerald-950 uppercase italic tracking-wider">BALANCE BROUGHT FORWARD</td>
                          <td className="px-12 py-10 text-center"><MethodBadge method={PaymentMethod.CASH} /></td>
                          <td className="px-12 py-10 text-right font-black text-emerald-600 text-3xl">Rs. {openingBalance.toLocaleString()}</td>
                          <td className="px-12 py-10 text-right text-slate-300 font-black">-</td>
                          {isEditor && <td></td>}
                        </tr>
                      )}
                      {mainEntries.map(e => (
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
                          {isEditor && <td className="px-12 py-10 text-center"><button onClick={() => removeMainEntry(e.id)} className="text-red-200 hover:text-red-700 font-black text-5xl">&times;</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {isEditor && (
                <div className="flex justify-center pt-10">
                  <button onClick={closeBook} className="bg-red-600 text-white px-32 py-10 rounded-[4rem] font-black text-2xl uppercase tracking-[0.4em] shadow-2xl hover:bg-red-700 active:scale-95 transition-all border-b-8 border-red-900">
                    CLOSE DAILY BOOK
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      )}

      {/* QR Pairing Overlay */}
      {showQr && (
        <div className="fixed inset-0 bg-slate-900/98 backdrop-blur-2xl z-[100] flex items-center justify-center p-6 animate-in zoom-in duration-300">
          <div className="bg-white p-16 rounded-[5rem] max-w-lg w-full text-center space-y-10 shadow-[0_0_120px_rgba(37,99,235,0.4)]">
            <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter">Mobile Sync Link</h2>
            <div className="bg-white p-6 rounded-[3rem] border-8 border-slate-50 flex justify-center mx-auto">
              <QRCodeSVG value={qrUrl} size={280} level="H" includeMargin />
            </div>
            <p className="text-slate-500 font-bold text-lg leading-relaxed">Scan this code with any smartphone camera to launch the real-time viewer instantly.</p>
            <button onClick={() => setShowQr(false)} className="w-full bg-slate-900 text-white py-6 rounded-[2.5rem] font-black uppercase tracking-widest text-xl hover:bg-black transition-all">Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Atomic Components ---

const CurrencyChip = ({ label, value, flag }: { label: string, value: number, flag: string }) => (
  <div className="bg-slate-50 border-2 border-slate-100 px-5 py-2.5 rounded-2xl flex flex-col items-center min-w-[120px]">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{flag} {label}</span>
    <span className="text-lg font-black text-slate-900">Rs. {value}</span>
  </div>
);

const PillStat = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className={`${color} px-8 py-5 rounded-[2rem] text-white shadow-xl min-w-[180px] text-center border-b-4 border-black/20`}>
    <p className="text-[9px] font-black opacity-60 uppercase tracking-widest mb-1">{label} TOTAL</p>
    <p className="text-2xl font-black">Rs. {value.toLocaleString()}</p>
  </div>
);

const SummaryCard = ({ label, value, color, highlight = false }: { label: string, value: number, color: string, highlight?: boolean }) => (
  <div className={`px-10 py-8 rounded-[3rem] bg-white/5 border-4 flex flex-col items-center justify-center ${highlight ? 'bg-green-500/10 border-green-500/50 ring-12 ring-green-500/5' : 'border-white/10'}`}>
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</span>
    <span className={`text-4xl font-black ${color}`}>Rs. {value.toLocaleString()}</span>
  </div>
);

const MiniStat = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className="flex justify-between items-center bg-slate-800/60 px-6 py-3 rounded-2xl border border-white/5">
    <span className={`text-[10px] font-black ${color} tracking-widest`}>{label}</span>
    <span className="text-lg font-black text-white ml-4">Rs.{value.toLocaleString()}</span>
  </div>
);

const MethodBadge = ({ method }: { method: PaymentMethod }) => {
  const styles = {
    [PaymentMethod.CASH]: "bg-blue-50 text-blue-700 border-blue-200",
    [PaymentMethod.CARD]: "bg-amber-50 text-amber-800 border-amber-300",
    [PaymentMethod.PAYPAL]: "bg-purple-50 text-purple-800 border-purple-300",
  };
  return <span className={`${styles[method]} border-2 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm`}>{method}</span>;
};

const OutEntryForm = ({ onAdd }: { onAdd: (m: PaymentMethod, a: number) => void }) => {
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [amount, setAmount] = useState('');
  return (
    <form className="flex flex-wrap items-end gap-6" onSubmit={e => { e.preventDefault(); onAdd(method, parseFloat(amount)); setAmount(''); }}>
      <div className="flex-1 min-w-[200px]">
        <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">Method</label>
        <select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} className="w-full border-4 p-4 rounded-2xl font-black appearance-none bg-white">
          <option value={PaymentMethod.CASH}>CASH</option><option value={PaymentMethod.CARD}>CARD</option><option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="flex-[2] min-w-[300px]">
        <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">Amount</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border-4 p-4 rounded-2xl font-black text-2xl" placeholder="0.00" required />
      </div>
      <button type="submit" className="px-12 py-5 bg-blue-700 text-white font-black rounded-2xl hover:bg-blue-800 shadow-xl uppercase text-xs tracking-widest transition-all border-b-4 border-blue-900">Add Entry</button>
    </form>
  );
};

const MainEntryForm = ({ onAdd }: { onAdd: (r: string, d: string, m: PaymentMethod, ci: number, co: number) => void }) => {
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
    <form className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-end" onSubmit={submit}>
      <div className="lg:col-span-1"><input value={room} onChange={e => setRoom(e.target.value)} className="w-full border-4 p-4 rounded-2xl font-black text-center" placeholder="RM#" /></div>
      <div className="lg:col-span-4"><input value={desc} onChange={e => setDesc(e.target.value)} className="w-full border-4 p-4 rounded-2xl font-black" placeholder="Description..." required /></div>
      <div className="lg:col-span-2"><select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} className="w-full border-4 p-4 rounded-2xl font-black bg-white">
        <option value={PaymentMethod.CASH}>CASH</option><option value={PaymentMethod.CARD}>CARD</option><option value={PaymentMethod.PAYPAL}>PAY PAL</option>
      </select></div>
      <div className="lg:col-span-2"><input type="number" value={ci} onChange={e => setCi(e.target.value)} className="w-full border-4 p-4 rounded-2xl font-black text-blue-600" placeholder="IN" /></div>
      <div className="lg:col-span-2"><input type="number" value={co} onChange={e => setCo(e.target.value)} className="w-full border-4 p-4 rounded-2xl font-black text-red-600" placeholder="OUT" /></div>
      <div className="lg:col-span-1"><button type="submit" className="w-full h-[66px] bg-slate-900 text-white rounded-2xl font-black text-xs hover:bg-black uppercase border-b-4 border-black shadow-lg">ADD</button></div>
    </form>
  );
};

const SyncOverlay = ({ onConnect }: { onConnect: (id: string) => void }) => {
  const [id, setId] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[100] flex items-center justify-center p-6">
      <div className="bg-white p-12 md:p-24 rounded-[5rem] shadow-[0_0_150px_-30px_rgba(30,58,138,0.6)] max-w-2xl w-full text-center space-y-12 animate-in zoom-in duration-500">
        <h2 className="text-6xl font-black text-slate-900 tracking-tighter uppercase leading-none">ENTER LEDGER ID</h2>
        <div className="space-y-8">
          <input value={id} onChange={e => setId(e.target.value.toUpperCase())} className="w-full p-12 bg-slate-100 rounded-[3.5rem] border-8 border-slate-200 font-black text-5xl text-center outline-none focus:border-blue-600 transition-all uppercase tracking-widest shadow-inner" placeholder="SHIVAS-ID" />
          <button onClick={() => id && onConnect(id.trim())} className="w-full p-12 bg-blue-700 text-white font-black rounded-[3.5rem] text-3xl hover:bg-blue-800 shadow-2xl active:scale-95 transition-all uppercase tracking-[0.3em] border-b-[12px] border-blue-900">Connect Mesh</button>
        </div>
        <p className="text-sm font-black text-blue-600 uppercase tracking-widest opacity-60">High-Performance Delta Sync Engine Active</p>
      </div>
    </div>
  );
};

const ArchiveList = ({ history }: { history: HistoryRecord[] }) => (
  <div className="space-y-10 animate-in fade-in slide-in-from-bottom duration-700">
    <h2 className="text-5xl font-black text-slate-900 uppercase tracking-widest border-l-[24px] border-slate-900 pl-12 leading-none">THE ARCHIVES</h2>
    <div className="grid gap-10">
      {history.length === 0 ? (
        <div className="p-40 bg-white rounded-[5rem] border-8 border-dashed border-slate-200 text-center text-slate-300 font-black uppercase tracking-[0.3em] italic text-3xl">Archive Empty</div>
      ) : (
        history.map((h, i) => (
          <div key={i} className="bg-white p-16 rounded-[4.5rem] shadow-2xl border-4 border-slate-100 flex flex-col md:flex-row justify-between items-center gap-12 group hover:border-blue-500 transition-all cursor-default">
            <div className="text-center md:text-left">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Date Closed</p>
              <p className="text-5xl font-black text-slate-900 tracking-tighter">{h.date}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Final Net Balance</p>
              <p className="text-5xl font-black text-emerald-600 tracking-tighter">Rs. {h.finalBalance.toLocaleString()}</p>
            </div>
            <button className="px-14 py-6 bg-slate-900 text-white font-black rounded-[2.5rem] hover:bg-black transition-all uppercase text-xs tracking-widest shadow-2xl active:scale-95">Full Report</button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default App;
