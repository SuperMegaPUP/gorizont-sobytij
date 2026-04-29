export interface Top100Instrument {
  ticker: string;
  name: string;
  turnover: number;
}

export async function fetchTop100FromMOEX(): Promise<Top100Instrument[]> {
  try {
    const baseUrl = process.env.MOEX_APIM_API || 'https://iss.moex.com';
    
    const url = `${baseUrl}/iss/engines/stock/markets/shares/boards/TQBR/securities.json`
      + '?iss.meta=off'
      + '&iss.only=securities,marketdata'
      + '&securities.columns=SECID,SHORTNAME'
      + '&marketdata.columns=SECID,VALTODAY'
      + '&sort_column=VALTODAY&sort_order=desc'
      + '&limit=100';

    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return [];

    const json = await res.json();
    
    const secRows = json?.securities?.data || [];
    const nameMap = new Map<string, string>();
    for (const r of secRows) {
      if (r[0]) nameMap.set(String(r[0]), String(r[1] || r[0]));
    }

    const mdRows = json?.marketdata?.data || [];
    return mdRows
      .filter((r: any[]) => r[0] && Number(r[1]) > 0)
      .slice(0, 100)
      .map((r: any[]) => ({
        ticker: String(r[0]),
        name: nameMap.get(String(r[0])) || String(r[0]),
        turnover: Number(r[1]),
      }));
  } catch {
    return [];
  }
}