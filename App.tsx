
import React, { useState, useEffect, useMemo } from 'react';
import Gun from 'gun';
import { QRCodeSVG } from 'qrcode.react';
import { PaymentMethod, DeviceType, OutPartyEntry, MainEntry, HistoryRecord } from './types';
import { fetchExchangeRates } from './services/geminiService';

/**
 * PRODUCTION MESH NETWORK
 * Using high-uptime nodes compatible with Vercel's TLS/CORS requirements.
 */
const MESH_RELAYS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us.herokuapp.com/gun',
  'https://peer.wall.org/gun',
  'https://gunjs.herokuapp.com/gun',
  'https://relay.p2p.legal/gun'
];

// Initialize Gun with production persistence
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
  
  // --- Sync Feedback ---
  const [viewHistory, setViewHistory] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [peerActive, setPeerActive] = useState(false);

  // --- Calculations (Requirements 13, 14, 15) ---
  const outPartyEntries = useMemo(() => 
    (Object.values(outPartyMap) as OutPartyEntry[]).sort((a, b) => a.index - b.index), 
  [outPartyMap]);

  const mainEntries = useMemo(() => 
    Object.values(mainEntryMap) as MainEntry[], 
  [mainEntryMap]);

  const totals = useMemo(() => {
    const opCash = outPartyEntries.filter(e => e.method === PaymentMethod.CASH).reduce((s, e) => s + (e.amount || 0), 0);
    const opCard = outPartyEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.amount || 0), 0);
    const opPaypal = outPartyEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.amount || 0), 0);

    const mCashIn = mainEntries.reduce((s, e) => s + (e.cashIn || 0), 0);
    const mCashOut = mainEntries.reduce((s, e) => s + (e.cashOut || 0), 0);
    
    const mCardIn = mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((s, e) => s + (e.cashIn || 0), 0);
    const mPaypalIn = mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((s, e) => s + (e.cashIn || 0), 0);

    const totalCard = opCard + mCardIn;
    const totalPaypal = opPaypal + mPaypalIn;

    // Requirement 13 & 15 Logic: 
    // Cash In = Initial + Direct + Total Non-Cash (Card/Paypal)
    // Cash Out = Direct Expenses + Moving Card/Paypal Balances
    const totalCashIn = openingBalance + mCashIn + opCash + opCard + opPaypal;
    const totalCashOut = mCashOut + totalCard + totalPaypal;

    return {
      opCash, opCard, opPaypal,
      totalCard, totalPaypal,
      totalCashIn, totalCashOut,
      balance: totalCashIn - totalCashOut
    };
  }, [outPartyEntries, mainEntries, openingBalance]);

  // --- Device Detection ---
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

  // --- Real-Time Connectivity ---
  useEffect(() => {
    if (!syncId) return;
    const db = gun.get('shivas_ledger_v8').get(syncId);

    const pulseInterval = setInterval(() => {
      if (device === DeviceType.LAPTOP) db.get('pulse').put(Date.now());
    }, 5000);

    db.get('pulse').on(() => {
      setPeerActive(true);
      setTimeout(() => setPeerActive(false), 5500);
    });

    db.get('balance').on((v) => {
      if (v !== undefined) setOpeningBalance(parseFloat(v as string));
    });

    db.get('outParty').map().on((data, id) => {
      if (data === null) {
        setOutPartyMap(p => { const n = { ...p }; delete n[id]; return n; });
      } else {
        setOutPartyMap(p => ({ ...p, [id]: JSON.parse(data as string) }));
      }
    });

    db.get('main').map().on((data, id) => {
      if (data === null) {
        setMainEntryMap(p => { const n = { ...p }; delete n[id]; return n; });
      } else {
        setMainEntryMap(p => ({ ...p, [id]: JSON.parse(data as string) }));
      }
    });

    db.get('history').on((data) => {
      if (data) setHistoryList(JSON.parse(data as string));
    });

    return () => { db.off(); clearInterval(pulseInterval); };
  }, [syncId, device]);

  // --- Operations ---
  const isEditor = device === DeviceType.LAPTOP;

  const addOutParty = (method: PaymentMethod, amount: number) => {
    if (!isEditor || !syncId) return;
    const id = crypto.randomUUID();
    const entry: OutPartyEntry = { id, index: outPartyEntries.length + 1, method, amount };
    gun.get('shivas_ledger_v8').get(syncId).get('outParty').get(id).put(JSON.stringify(entry));
  };

  const removeOutParty = (id: string) => {
    if (!isEditor || !syncId) return;
    gun.get('shivas_ledger_v8').get(syncId).get('outParty').get(id).put(null);
  };

  const addMainEntry = (roomNo: string, description: string, method: PaymentMethod, cashIn: number, cashOut: number) => {
    if (!isEditor || !syncId) return;
    const id = crypto.randomUUID();
    const entry: MainEntry = { id, roomNo, description, method, cashIn, cashOut };
    gun.get('shivas_ledger_v8').get(syncId).get('main').get(id).put(JSON.stringify(entry));
  };

  const removeMainEntry = (id: string) => {
    if (!isEditor || !syncId) return;
    gun.get('shivas_ledger_v8').get(syncId).get('main').get(id).put(null);
  };

  const finalizeBook = () => {
    if (!isEditor || !syncId) return;
    if (!confirm("Closing current day. Today's balance will be carried forward.")) return;

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

    const db = gun.get('shivas_ledger_v8').get(syncId);
    outPartyEntries.forEach(e => db.get('outParty').get(e.id).put(null));
    mainEntries.forEach(e => db.get('main').get(e.id).put(null));
    db.get('balance').put(totals.balance.toString());
    db.get('history').put(JSON.stringify([record, ...historyList]));
  };

  // --- QR & Linking ---
  const qrUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}?sid=${syncId}#${DeviceType.ANDROID}`;
  }, [syncId]);

  if (!isReady) return null;

  // Security Check (Requirement 4)
  if (device === DeviceType.LAPTOP && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col items-center justify-center p-12 text-center text-white">
        <div className="bg-red-500/10 border-4 border-red-500 p-12 rounded-[4rem] max-w-xl space-y-8">
          <h2 className="text-5xl font-black uppercase tracking-tighter">Editor Restricted</h2>
          <p className="text-xl font-bold text-slate-300">Management interface is only accessible from desktop workstations. Please use your device in Viewer mode.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-48">
      {/* Premium Header */}
      <header className="bg-white border-b-8 border-slate-900 sticky top-0 z-[100] shadow-2xl px-6 py-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-10">
          <div className="text-center md:text-left">
            <h1 className="text-5xl md:text-7xl font-black text-slate-900 tracking-tighter uppercase leading-none">SHIVAS BEACH CABANAS</h1>
            <div className="flex items-center justify-center md:justify-start gap-6 mt-4">
              <span className="text-[13px] font-black text-slate-400 uppercase tracking-[0.5em]">{new Date().toDateString()}</span>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${peerActive ? 'bg-blue-600 sync-pulse' : 'bg-slate-200'}`}></div>
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Global Mesh Sync Active</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <RateBox label="USD" value={rates.usd} flag="🇺🇸" />
            <RateBox label="EUR" value={rates.eur} flag="🇪🇺" />
            {isEditor && (
              <button onClick={() => setShowQr(true)} className="bg-slate-900 text-white p-6 rounded-[2rem] hover:bg-blue-600 transition-all shadow-xl active:scale-90">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {!syncId ? (
        <AuthGate onConnect={(id) => { setSyncId(id); localStorage.setItem('shivas_sync_id', id); }} />
      ) : (
        <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-16">
          
          <div className="flex justify-between items-center bg-white border-4 border-slate-900 p-8 rounded-[3rem] shadow-2xl">
            <div className="flex items-center gap-6">
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Vault Instance:</span>
              <span className="text-4xl font-black text-blue-800 tracking-tighter select-all">{syncId}</span>
            </div>
            <button onClick={() => setViewHistory(!viewHistory)} className="bg-slate-900 text-white px-12 py-5 rounded-full font-black text-xs uppercase tracking-widest hover:bg-blue-800 transition-all shadow-xl active:scale-95">
              {viewHistory ? 'Return to Live' : 'View Archives'}
            </button>
          </div>

          {viewHistory ? (
            <ArchiveView history={historyList} />
          ) : (
            <div className="space-y-16 animate-in fade-in duration-700">
              
              {/* Out Party */}
              <section className="bg-white rounded-[4rem] shadow-2xl border-4 border-slate-900 overflow-hidden">
                <div className="bg-blue-800 p-12 flex flex-col md:flex-row justify-between items-center gap-10">
                  <h2 className="text-4xl font-black text-white uppercase tracking-[0.3em]">OUT PARTY BOOK</h2>
                  <div className="flex flex-wrap justify-center gap-6">
                    <StatPill label="CASH" value={totals.opCash} color="bg-blue-900" />
                    <StatPill label="CARD" value={totals.opCard} color="bg-amber-500" />
                    <StatPill label="PAYPAL" value={totals.opPaypal} color="bg-purple-600" />
                  </div>
                </div>
                {isEditor && <div className="p-12 bg-blue-50/50 border-b-4 border-blue-100"><OutEntryForm onAdd={addOutParty} /></div>}
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b-4 border-slate-900/10">
                      <tr>
                        <th className="px-14 py-8 text-xs font-black text-slate-500 uppercase tracking-widest w-24 text-center">No</th>
                        <th className="px-14 py-8 text-xs font-black text-slate-500 uppercase tracking-widest">Payment Mode</th>
                        <th className="px-14 py-8 text-xs font-black text-slate-500 uppercase tracking-widest text-right">Amount (LKR)</th>
                        {isEditor && <th className="px-14 py-8 w-24"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-slate-50">
                      {outPartyEntries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-14 py-10 text-center font-black text-slate-300 text-3xl">{e.index}</td>
                          <td className="px-14 py-10"><MethodTag method={e.method} /></td>
                          <td className="px-14 py-10 text-right font-black text-5xl text-slate-900">Rs. {e.amount.toLocaleString()}</td>
                          {isEditor && <td className="px-14 py-10 text-center"><button onClick={() => removeOutParty(e.id)} className="text-red-300 hover:text-red-600 font-black text-6xl">&times;</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Master Ledger */}
              <section className="bg-white rounded-[4rem] shadow-[0_60px_120px_-30px_rgba(0,0,0,0.5)] border-4 border-slate-900 overflow-hidden">
                <div className="bg-slate-900 p-16">
                  <div className="flex flex-col lg:flex-row justify-between items-center gap-14">
                    <h2 className="text-5xl font-black text-white uppercase tracking-[0.4em]">MASTER LEDGER</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-10 w-full lg:w-auto">
                      <TotalBlock label="CASH IN" value={totals.totalCashIn} color="text-blue-400" />
                      <TotalBlock label="CASH OUT" value={totals.totalCashOut} color="text-red-400" />
                      <TotalBlock label="NET BAL" value={totals.balance} color="text-green-400" highlight />
                      <div className="flex flex-col gap-5">
                        <SmallStatBlock label="CARD TOTAL" value={totals.totalCard} color="text-amber-500" />
                        <SmallStatBlock label="PAYPAL TOTAL" value={totals.totalPaypal} color="text-purple-500" />
                      </div>
                    </div>
                  </div>
                </div>
                {isEditor && <div className="p-14 bg-slate-50 border-b-4 border-slate-200"><MainEntryForm onAdd={addMainEntry} /></div>}
                <div className="overflow-x-auto">
                  <table className="w-full text-left table-fixed min-w-[1400px]">
                    <thead className="bg-slate-50 text-[12px] font-black text-slate-500 uppercase tracking-[0.3em] border-b-4 border-slate-900/10">
                      <tr>
                        <th className="px-16 py-10 w-32">ROOM</th>
                        <th className="px-16 py-10 w-2/5">GUEST DETAILS / DESCRIPTION</th>
                        <th className="px-16 py-10 w-40 text-center">MODE</th>
                        <th className="px-16 py-10 w-64 text-right">IN (Rs)</th>
                        <th className="px-16 py-10 w-64 text-right">OUT (Rs)</th>
                        {isEditor && <th className="px-16 py-10 w-24"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-slate-100">
                      {openingBalance !== 0 && (
                        <tr className="bg-emerald-50/60">
                          <td className="px-16 py-14 font-black text-emerald-800 text-4xl">OPEN</td>
                          <td className="px-16 py-14 font-black text-emerald-950 uppercase italic tracking-[0.2em] text-2xl">BALANCE BROUGHT FORWARD</td>
                          <td className="px-16 py-14 text-center"><MethodTag method={PaymentMethod.CASH} /></td>
                          <td className="px-16 py-14 text-right font-black text-emerald-600 text-5xl">Rs. {openingBalance.toLocaleString()}</td>
                          <td className="px-16 py-14 text-right text-slate-300 font-black">-</td>
                          {isEditor && <td></td>}
                        </tr>
                      )}
                      {mainEntries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-all">
                          <td className="px-16 py-14 font-black text-slate-950 text-4xl">{e.roomNo || '--'}</td>
                          <td className="px-16 py-14 font-black text-slate-800 text-3xl leading-relaxed">{e.description}</td>
                          <td className="px-16 py-14 text-center"><MethodTag method={e.method} /></td>
                          <td className="px-16 py-14 text-right font-black text-blue-700 text-5xl">
                             {e.cashIn > 0 ? `Rs. ${e.cashIn.toLocaleString()}` : '-'}
                          </td>
                          <td className="px-16 py-14 text-right font-black text-red-700 text-5xl">
                             {e.cashOut > 0 ? `Rs. ${e.cashOut.toLocaleString()}` : '-'}
                          </td>
                          {isEditor && <td className="px-16 py-14 text-center"><button onClick={() => removeMainEntry(e.id)} className="text-red-200 hover:text-red-700 font-black text-7xl transition-all">&times;</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {isEditor && (
                <div className="flex justify-center pt-16">
                  <button onClick={finalizeBook} className="bg-red-700 text-white px-48 py-14 rounded-[6rem] font-black text-4xl uppercase tracking-[0.4em] shadow-2xl hover:bg-red-800 active:scale-95 transition-all border-b-[16px] border-red-950">
                    CLOSE DAILY BOOK
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      )}

      {/* QR Code Portal */}
      {showQr && (
        <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[200] flex items-center justify-center p-8 animate-in zoom-in duration-300">
          <div className="bg-white p-24 rounded-[7rem] max-w-3xl w-full text-center space-y-16 shadow-[0_0_180px_rgba(37,99,235,0.6)]">
            <h2 className="text-6xl font-black text-slate-900 uppercase tracking-tighter">Mobile View Access</h2>
            <div className="bg-white p-12 rounded-[5rem] border-8 border-slate-50 flex justify-center mx-auto shadow-inner">
              <QRCodeSVG value={qrUrl} size={380} level="H" includeMargin />
            </div>
            <p className="text-slate-500 font-bold text-3xl leading-snug">Scan with your smartphone to launch the live financial dashboard instantly.</p>
            <button onClick={() => setShowQr(false)} className="w-full bg-slate-900 text-white py-10 rounded-[4rem] font-black uppercase tracking-widest text-3xl hover:bg-black transition-all border-b-8 border-black">Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Atomic Components ---

const RateBox = ({ label, value, flag }: { label: string, value: number, flag: string }) => (
  <div className="bg-slate-50 border-4 border-slate-100 px-8 py-4 rounded-[2.5rem] flex flex-col items-center min-w-[160px] shadow-sm">
    <span className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-1">{flag} {label}</span>
    <span className="text-3xl font-black text-slate-950">Rs. {value}</span>
  </div>
);

const StatPill = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className={`${color} px-12 py-7 rounded-[3rem] text-white shadow-2xl min-w-[220px] text-center border-b-4 border-black/40`}>
    <p className="text-[11px] font-black opacity-80 uppercase tracking-widest mb-2">{label} TOTAL</p>
    <p className="text-4xl font-black">Rs. {value.toLocaleString()}</p>
  </div>
);

const TotalBlock = ({ label, value, color, highlight = false }: { label: string, value: number, color: string, highlight?: boolean }) => (
  <div className={`px-14 py-12 rounded-[5rem] bg-white/5 border-4 flex flex-col items-center justify-center ${highlight ? 'bg-green-500/20 border-green-500/70 ring-[24px] ring-green-500/5' : 'border-white/10'}`}>
    <span className="text-[13px] font-black text-slate-400 uppercase tracking-widest mb-4">{label}</span>
    <span className={`text-6xl font-black ${color}`}>Rs. {value.toLocaleString()}</span>
  </div>
);

const SmallStatBlock = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className="flex justify-between items-center bg-slate-800/80 px-10 py-5 rounded-[2rem] border border-white/5 shadow-inner">
    <span className={`text-[12px] font-black ${color} tracking-[0.2em]`}>{label}</span>
    <span className="text-2xl font-black text-white ml-8">Rs.{value.toLocaleString()}</span>
  </div>
);

const MethodTag = ({ method }: { method: PaymentMethod }) => {
  const styles = {
    [PaymentMethod.CASH]: "bg-blue-50 text-blue-700 border-blue-300",
    [PaymentMethod.CARD]: "bg-amber-50 text-amber-800 border-amber-400",
    [PaymentMethod.PAYPAL]: "bg-purple-50 text-purple-800 border-purple-400",
  };
  return <span className={`${styles[method]} border-2 px-8 py-4 rounded-full text-[13px] font-black uppercase tracking-widest shadow-sm`}>{method}</span>;
};

const OutEntryForm = ({ onAdd }: { onAdd: (m: PaymentMethod, a: number) => void }) => {
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [amount, setAmount] = useState('');
  return (
    <form className="flex flex-wrap items-end gap-10" onSubmit={e => { e.preventDefault(); onAdd(method, parseFloat(amount)); setAmount(''); }}>
      <div className="flex-1 min-w-[280px]">
        <label className="block text-xs font-black text-slate-500 mb-4 uppercase tracking-widest">Payment Mode</label>
        <select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} className="w-full border-4 p-6 rounded-[2.5rem] font-black text-2xl appearance-none bg-white">
          <option value={PaymentMethod.CASH}>CASH</option><option value={PaymentMethod.CARD}>CARD</option><option value={PaymentMethod.PAYPAL}>PAY PAL</option>
        </select>
      </div>
      <div className="flex-[2] min-w-[400px]">
        <label className="block text-xs font-black text-slate-500 mb-4 uppercase tracking-widest">Amount (Rs)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border-4 p-6 rounded-[2.5rem] font-black text-4xl placeholder-slate-200" placeholder="0.00" required />
      </div>
      <button type="submit" className="px-20 py-8 bg-blue-700 text-white font-black rounded-[2.5rem] hover:bg-blue-800 shadow-xl uppercase text-sm tracking-widest transition-all border-b-8 border-blue-950">Add Collection</button>
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
    <form className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end" onSubmit={submit}>
      <div className="lg:col-span-1"><input value={room} onChange={e => setRoom(e.target.value)} className="w-full border-4 p-6 rounded-[1.5rem] font-black text-center text-2xl" placeholder="RM#" /></div>
      <div className="lg:col-span-4"><input value={desc} onChange={e => setDesc(e.target.value)} className="w-full border-4 p-6 rounded-[1.5rem] font-black text-2xl" placeholder="Entry description..." required /></div>
      <div className="lg:col-span-2"><select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} className="w-full border-4 p-6 rounded-[1.5rem] font-black text-2xl bg-white">
        <option value={PaymentMethod.CASH}>CASH</option><option value={PaymentMethod.CARD}>CARD</option><option value={PaymentMethod.PAYPAL}>PAY PAL</option>
      </select></div>
      <div className="lg:col-span-2"><input type="number" value={ci} onChange={e => setCi(e.target.value)} className="w-full border-4 p-6 rounded-[1.5rem] font-black text-blue-700 text-2xl" placeholder="IN" /></div>
      <div className="lg:col-span-2"><input type="number" value={co} onChange={e => setCo(e.target.value)} className="w-full border-4 p-6 rounded-[1.5rem] font-black text-red-700 text-2xl" placeholder="OUT" /></div>
      <div className="lg:col-span-1"><button type="submit" className="w-full h-[88px] bg-slate-900 text-white rounded-[1.5rem] font-black text-xs hover:bg-black uppercase border-b-8 border-black shadow-2xl">ADD</button></div>
    </form>
  );
};

const AuthGate = ({ onConnect }: { onConnect: (id: string) => void }) => {
  const [id, setId] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[200] flex items-center justify-center p-8">
      <div className="bg-white p-24 md:p-40 rounded-[7rem] shadow-[0_0_240px_-60px_rgba(30,58,138,0.8)] max-w-4xl w-full text-center space-y-20 animate-in zoom-in duration-500">
        <h2 className="text-8xl font-black text-slate-900 tracking-tighter uppercase leading-none">SECURE ACCESS</h2>
        <div className="space-y-12">
          <input value={id} onChange={e => setId(e.target.value.toUpperCase())} className="w-full p-20 bg-slate-100 rounded-[5rem] border-8 border-slate-200 font-black text-7xl text-center outline-none focus:border-blue-600 transition-all uppercase tracking-[0.4em] shadow-inner" placeholder="VAULT-ID" />
          <button onClick={() => id && onConnect(id.trim())} className="w-full p-20 bg-blue-700 text-white font-black rounded-[5rem] text-5xl hover:bg-blue-800 shadow-2xl active:scale-95 transition-all uppercase tracking-[0.5em] border-b-[20px] border-blue-950">Pair Ledger</button>
        </div>
        <p className="text-2xl font-black text-blue-600 uppercase tracking-widest opacity-60">Production Mesh Environment Protocol Active</p>
      </div>
    </div>
  );
};

const ArchiveView = ({ history }: { history: HistoryRecord[] }) => (
  <div className="space-y-16 animate-in fade-in slide-in-from-bottom duration-700">
    <h2 className="text-7xl font-black text-slate-900 uppercase tracking-widest border-l-[36px] border-slate-900 pl-20 leading-none">SETTLEMENT HISTORY</h2>
    <div className="grid gap-16">
      {history.length === 0 ? (
        <div className="p-80 bg-white rounded-[7rem] border-8 border-dashed border-slate-200 text-center text-slate-300 font-black uppercase tracking-[0.5em] italic text-5xl">Archive Empty</div>
      ) : (
        history.map((h, i) => (
          <div key={i} className="bg-white p-24 rounded-[6rem] shadow-2xl border-4 border-slate-100 flex flex-col md:flex-row justify-between items-center gap-20 group hover:border-blue-700 transition-all cursor-default">
            <div className="text-center md:text-left">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Settlement Timestamp</p>
              <p className="text-7xl font-black text-slate-900 tracking-tighter">{h.date}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Closing Portfolio Balance</p>
              <p className="text-7xl font-black text-emerald-600 tracking-tighter">Rs. {h.finalBalance.toLocaleString()}</p>
            </div>
            <button className="px-24 py-10 bg-slate-900 text-white font-black rounded-[4rem] hover:bg-black transition-all uppercase text-sm tracking-widest shadow-2xl active:scale-95 border-b-8 border-black">View Full Details</button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default App;
