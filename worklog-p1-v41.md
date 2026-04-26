---
Task ID: П1-v4.1
Agent: main
Task: П1 правки детекторов по спецификации v4.1

Work Log:
- Обновлены все CONTEXT файлы под спецификацию v4.1 (SPRINT-PLAN, SIGNALS, DETECTORS, ARCHITECTURE, KNOWN-ISSUES)
- П1-1: BSCI η=0.03 (было 0.1) + min_w=0.04 (было 0.02) в save-observation.ts
- П1-2: HAWKING полная переделка — ACF + PSD (FFT/Welch) + noise_ratio через median_psd + N≥50 минимум
- П1-3: DARKMATTER полная переделка — ΔH_norm (Shannon entropy) + iceberg consecutive runs + MIN_ICEBERG_VOLUME 0.5% + n≥3
- П1-4: DECOHERENCE полная переделка — символьный поток round(log2(vol)*dir) + tick_rule при ΔP=0 + Shannon entropy
- Обновлены тесты horizon-detectors.test.ts и horizon-observer.test.ts под новые формулы
- Все 177 тестов проходят
- Build успешен
- Деплой на PROD (robot-detect-v3.vercel.app) и LAB (robot-lab-v3.vercel.app)
- Push на GitHub

Stage Summary:
- Все 4 П1 правки реализованы и задеплоены
- BSCI: η снижен с 0.1 до 0.03, min_w повышен с 0.02 до 0.04
- HAWKING: ACF+PSD вместо VPIN-only, noise_ratio через median_psd
- DARKMATTER: ΔH_norm + iceberg consecutive вместо hiddenRatio+volumeSurprise
- DECOHERENCE: символьный поток + tick_rule вместо OFI/CumDelta flow divergence
- СЛЕДУЮЩИЙ ШАГ: замерить новые BSCI/convergence распределения после 1 сессии
