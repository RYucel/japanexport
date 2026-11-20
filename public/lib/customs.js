/**
 * KKTC araç ithalat vergi motoru.
 *
 * Oranlar, Neveser Gümrükleme Ltd.'nin (nevesergumrukleme.com) kamuya açık
 * "KKTC Araç Gümrük Hesaplama" aracındaki modele göre uygulanmıştır:
 *   · Gümrük Vergisi: 2026 alan uzmanı teyidi
 *   · FİF: 2026 Ağustos FİF Emirnamesi (RG 44, EK III, yürürlük 03.08.2026)
 *   · KDV: 2025 Yılı KDV Oranları Tüzüğü
 *
 * ÖNEMLİ: Bu bir tahmindir. KKTC Gümrük Dairesi vergi matrahını kendi
 * belirlediği araç değerine göre saptar; fatura/CIF yalnızca yaklaşık sonuç verir.
 */

export const ORIGIN_GROUP = {
  ab: 'avrupa',
  avrupa: 'avrupa',
  ingiltere: 'avrupa',
  turkiye: 'turkiye',
  japonya: 'other',
  diger: 'other',
  other: 'other'
};

export const VEHICLE_TYPES = {
  otomobil: 'Salon araç (otomobil)',
  suv: 'SUV / Arazi',
  ticari: 'Van / Çift kabin / Ticari',
  tir: 'TIR çekicisi',
  karavan: 'Motorlu karavan',
  motosiklet: 'Motosiklet',
  klasikarac: 'Klasik araç (25+ yaş)',
  klasikmoto: 'Klasik motosiklet (25+ yaş)'
};

/** Gümrük vergisi oranı */
export function customsRate({ vehicleType = 'suv', fuel = 'benzin', cc = 2000, originGroup = 'other' }) {
  if (originGroup === 'turkiye') return 0; // Türkiye menşeli tam muaf

  if (vehicleType === 'ticari') {
    if (originGroup === 'avrupa') return 0;
    return cc <= 2500 ? 0.1 : 0.22;
  }
  if (vehicleType === 'tir') {
    return originGroup === 'avrupa' ? 0 : 0.16;
  }
  if (vehicleType === 'motosiklet' || vehicleType === 'klasikmoto') {
    if (fuel === 'elektrik') return originGroup === 'avrupa' ? 0 : 0.1;
    if (originGroup === 'avrupa') return 0;
    return cc <= 250 ? 0.145 : 0.06;
  }

  // salon / suv / klasik araç / karavan
  if (fuel === 'elektrik') return originGroup === 'avrupa' ? 0 : 0.1;
  if (originGroup === 'avrupa') {
    if (fuel === 'dizel') return cc <= 2500 ? 0 : 0.1;
    return cc <= 2000 ? 0 : 0.1;
  }
  return 0.1; // Japonya / 3. ülke
}

/** Fiyat İstikrar Fonu oranı */
export function fifRate({ vehicleType = 'suv', fuel = 'benzin', cc = 2000, originGroup = 'other', ageIdx = 0 }) {
  if (vehicleType === 'karavan') return 0.15;
  if (vehicleType === 'klasikarac' || vehicleType === 'klasikmoto') return 0.06;

  if (vehicleType === 'motosiklet' && fuel !== 'elektrik') {
    const euro = originGroup === 'avrupa' || originGroup === 'turkiye';
    if (cc <= 80) return euro ? 0.085 : 0.06;
    if (cc <= 125) return euro ? 0.185 : 0.145;
    return euro ? 0.235 : 0.35;
  }

  if (vehicleType === 'tir') {
    if (ageIdx < 1) return 0.05;
    return originGroup === 'avrupa' || originGroup === 'turkiye' ? 0.25 : 0.3;
  }

  if (vehicleType === 'ticari') {
    const abTier = originGroup === 'avrupa' || originGroup === 'turkiye';
    if (abTier) return ageIdx < 1 ? 0.16 : 0.31;
    return ageIdx < 1 ? 0.06 : 0.21;
  }

  // Binek (87.03)
  if (fuel === 'elektrik') return 0.05;
  if (originGroup === 'turkiye') {
    if (cc <= 1500) return 0.03 * 0.5; // %1,5
    if (cc <= 2000) return 0.03 * 0.7; // %2,1
    if (cc <= 3000) return 0.08 * 0.7; // %5,6
    return 0.12 * 0.7; // %8,4
  }
  if (cc <= 2000) return 0.03;
  if (cc <= 3000) return 0.08;
  return 0.12;
}

/** FİF'in sabit TL kısmı (klasik 750 TL; motosiklet 375/750 TL) */
export function fifFixedTry({ vehicleType = 'suv', fuel = 'benzin', cc = 2000 }) {
  if (vehicleType === 'klasikarac' || vehicleType === 'klasikmoto') return 750;
  if (vehicleType === 'motosiklet' && fuel !== 'elektrik') return cc <= 80 ? 0 : cc <= 125 ? 375 : 750;
  return 0;
}

/** KDV oranı */
export function vatRate({ vehicleType = 'suv', fuel = 'benzin', cc = 2000 }) {
  if (fuel === 'elektrik') return 0.05;
  if (vehicleType === 'ticari' || vehicleType === 'tir') return 0.16;
  if (vehicleType === 'motosiklet' || vehicleType === 'klasikmoto') return cc > 200 ? 0.2 : 0.16;
  return 0.2;
}

/**
 * CIF (TRY) üzerinden KKTC ithalat vergilerini hesaplar.
 *
 * @param {object} p
 * @param {number} p.cifTry        Aracın CIF değeri (araç + navlun + sigorta), TRY
 * @param {string} [p.vehicleType] otomobil | suv | ticari | tir | karavan | motosiklet | klasikarac | klasikmoto
 * @param {string} [p.fuel]        benzin | dizel | elektrik
 * @param {number} [p.cc]          Motor hacmi (cc)
 * @param {string} [p.origin]      japonya | avrupa | ab | ingiltere | turkiye | diger
 * @param {number} [p.ageIdx]      0 = 0-8 yaş, 1 = 8-12 yaş (yalnızca ticari/TIR için anlamlı)
 * @param {string} [p.importer]    sahis (bireysel) | galeri (satıcı ruhsatı)
 * @param {string} [p.mode]        sea (liman) | ercan (havalimanı)
 */
export function computeCustoms({
  cifTry,
  vehicleType = 'suv',
  fuel = 'benzin',
  cc = 2000,
  origin = 'japonya',
  ageIdx = 0,
  importer = 'sahis',
  mode = 'sea'
}) {
  const originGroup = ORIGIN_GROUP[String(origin).toLowerCase()] || 'other';
  const isSahis = importer !== 'galeri';
  const isErcan = mode === 'ercan';
  const v = Math.max(0, Number(cifTry) || 0);
  const engineCc = Number(cc) || 0;

  const cRate = customsRate({ vehicleType, fuel, cc: engineCc, originGroup });
  const fRate = fifRate({ vehicleType, fuel, cc: engineCc, originGroup, ageIdx });
  const fFixed = fifFixedTry({ vehicleType, fuel, cc: engineCc });
  const kRate = vatRate({ vehicleType, fuel, cc: engineCc });

  const customs = v * cRate;
  const fif = v * fRate + fFixed;
  const ozelFon = isSahis ? v * 0.15 : 0;
  const wharf = isErcan ? 0 : v * 0.044; // rıhtım harcı
  const gkk = v * 0.025;
  const stopaj = isSahis ? 0 : v * 0.04;
  const bandrol = v * 0.003 + 50; // %0,3 + 50 TL

  // KDV matrahı: CIF + Gümrük + FİF + Özel Fon + Rıhtım + GKK + Bandrol (stopaj hariç)
  const vatBase = v + customs + fif + ozelFon + wharf + gkk + bandrol;
  const kdv = vatBase * kRate;

  const totalTax = customs + fif + ozelFon + wharf + gkk + stopaj + bandrol + kdv;

  return {
    originGroup,
    importer,
    mode,
    rates: {
      customs: cRate,
      fif: fRate,
      fifFixedTry: fFixed,
      ozelFon: isSahis ? 0.15 : 0,
      wharf: isErcan ? 0 : 0.044,
      gkk: 0.025,
      stopaj: isSahis ? 0 : 0.04,
      bandrol: 0.003,
      bandrolFixedTry: 50,
      vat: kRate
    },
    lines: [
      { key: 'customs', label: 'Gümrük Vergisi', rate: cRate, amountTry: customs },
      { key: 'fif', label: 'Fiyat İstikrar Fonu (FİF)', rate: fRate, amountTry: fif },
      ...(isSahis
        ? [{ key: 'ozelFon', label: 'Özel Fon', rate: 0.15, amountTry: ozelFon }]
        : [{ key: 'stopaj', label: 'Stopaj', rate: 0.04, amountTry: stopaj }]),
      { key: 'wharf', label: 'Rıhtım Harcı', rate: isErcan ? 0 : 0.044, amountTry: wharf },
      { key: 'gkk', label: 'GKK', rate: 0.025, amountTry: gkk },
      { key: 'bandrol', label: 'Bandrol', rate: 0.003, amountTry: bandrol },
      { key: 'kdv', label: 'KDV', rate: kRate, amountTry: kdv }
    ],
    vatBaseTry: vatBase,
    totalTaxTry: totalTax,
    grandTotalTry: v + totalTax,
    effectiveRate: v > 0 ? totalTax / v : 0
  };
}
