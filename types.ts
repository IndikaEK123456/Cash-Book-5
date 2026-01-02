
export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  PAYPAL = 'PAYPAL'
}

export enum DeviceType {
  LAPTOP = 'laptop',
  ANDROID = 'android',
  IPHONE = 'iphone'
}

export interface OutPartyEntry {
  id: string;
  index: number;
  method: PaymentMethod;
  amount: number;
}

export interface MainEntry {
  id: string;
  roomNo: string;
  description: string;
  method: PaymentMethod;
  cashIn: number;
  cashOut: number;
}

export interface DailyRecord {
  date: string;
  openingBalance: number;
  outPartyEntries: OutPartyEntry[];
  mainEntries: MainEntry[];
  rates: {
    usd: number;
    eur: number;
  };
}

export interface HistoryRecord {
  date: string;
  record: DailyRecord;
  finalBalance: number;
}
