// ─── Horizon Calculations — TDD заглушки ────────────────────────────────
// OFI, Cumulative Delta, VPIN

describe.skip('Horizon: OFI (Order Flow Imbalance)', () => {
  test('OFI = (V_bid - V_ask) / (V_bid + V_ask)', () => {
    // TODO: Реализовать в Фазе 1
    expect(true).toBe(true);
  });

  test('OFI = 0 при пустом стакане', () => {
    expect(true).toBe(true);
  });

  test('Weighted OFI: ближние уровни важнее', () => {
    expect(true).toBe(true);
  });

  test('OFI ∈ [-1, 1]', () => {
    expect(true).toBe(true);
  });
});

describe.skip('Horizon: Cumulative Delta', () => {
  test('CumDelta = Σ(buy_vol - sell_vol)', () => {
    expect(true).toBe(true);
  });

  test('CumDelta = 0 при пустых данных', () => {
    expect(true).toBe(true);
  });

  test('MOEX BUYSELL: B → buy, S → sell', () => {
    expect(true).toBe(true);
  });

  test('Tinkoff direction: BUY → buy, SELL → sell', () => {
    expect(true).toBe(true);
  });

  test('CumDelta монотонно обновляется', () => {
    expect(true).toBe(true);
  });
});

describe.skip('Horizon: VPIN', () => {
  test('VPIN = Σ|V_buy - V_sell| / Σ(V_buy + V_sell) по 50 корзинам', () => {
    expect(true).toBe(true);
  });

  test('VPIN = 0 при одинаковых buy/sell', () => {
    expect(true).toBe(true);
  });

  test('VPIN > 0.6 = высокая токсичность', () => {
    expect(true).toBe(true);
  });

  test('BVC классификация: V_buy = V × Φ((close-open)/σ)', () => {
    expect(true).toBe(true);
  });

  test('VPIN ∈ [0, 1]', () => {
    expect(true).toBe(true);
  });
});
