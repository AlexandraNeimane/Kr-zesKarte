// Offline PDF: a printable text version of the map for the user's location and chosen radius.
const path = require('path');
const PDFDocument = require('pdfkit');

const FONT = path.join(__dirname, '..', 'data', 'fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'data', 'fonts', 'NotoSans-Bold.ttf');
const C = { ink: '#1b1640', muted: '#5e5a78', purple: '#4b22a8', green: '#157a45', red: '#b0172b', amber: '#8a5a00', line: '#dcd8ea' };

const T = {
  lv: {
    title: 'Krīzes karte — bezsaistes kopija',
    subtitle: 'Saglabājiet tālrunī vai izdrukājiet. Noder, ja nav interneta.',
    generated: 'Izveidots', location: 'Jūsu atrašanās vieta', radius: 'Rādiuss',
    outdatedTitle: 'Informācija var būt novecojusi',
    outdated: 'Šis dokuments atspoguļo stāvokli tā izveides brīdī. Situācija var mainīties — kad iespējams, pārbaudiet aktuālo informāciju tīmekļa vietnē vai klausieties radio.',
    radio: 'Nav interneta? Ieslēdziet radio: {freq} · radio tālrunis {rphone}. Krīzes situācijā klausieties oficiālos norādījumus.',
    numbersTitle: 'Svarīgākie tālruņi',
    numbers: [
      ['112', 'Vienotais ārkārtas palīdzības numurs (ugunsdzēsēji, glābēji, policija, ātrā palīdzība) — bez maksas, darbojas arī bez SIM kartes'],
      ['{phone}', 'Ārkārtas dienesta bezmaksas diennakts tālrunis'],
      ['110', 'Valsts policija'],
      ['113', 'Neatliekamā medicīniskā palīdzība'],
      ['114', 'Gāzes avārijas dienests'],
      ['8404', 'AS "Sadales tīkls" — elektrības bojājumi un pārrauti vadi'],
      ['66016001', 'Ģimenes ārstu konsultatīvais tālrunis (diennakts)'],
      ['67042473', 'Saindēšanās un zāļu informācijas centrs'],
      ['116 111', 'Bērnu un pusaudžu uzticības tālrunis'],
    ],
    mapTitle: 'Karte: {km} km ap jūsu atrašanās vietu',
    mapNote: 'Kartē atzīmētas bīstamības un līdz {n} tuvākajām vietām katrā kategorijā. Apzīmējumi sakrīt ar sarakstiem tālāk dokumentā.',
    mapUnavailable: 'Karti neizdevās ielādēt — izmantojiet sarakstus, virzienus un koordinātas.',
    legYou: 'Jūs', legHazard: 'Bīstamība / problēma', legShelter: 'Patvertne', legAtm: 'Krīzes bankomāts', legFuel: 'Degvielas stacija',
    legRadius: '{km} km rādiuss', legRoad: 'Skartais ceļa posms',
    codes: { shelter: 'P', atm: 'K', fuel: 'D' },
    forecastTitle: 'Prognoze nākamajām 24 stundām (tikai kritiskā informācija)',
    forecastPlace: 'Tuvākā apdzīvotā vieta: {place}',
    forecastNone: 'Kritiski laikapstākļi nav gaidāmi.',
    hazardsTitle: 'Bīstamības un problēmas {km} km rādiusā',
    hazardsNone: 'Dokumenta izveides brīdī {km} km rādiusā nav zināmu bīstamību vai problēmu.',
    sheltersTitle: 'Patvertnes', atmsTitle: 'Krīzes bankomāti', fuelTitle: 'Degvielas uzpildes stacijas',
    placesNone: '{km} km rādiusā nav atrasta neviena vieta.',
    placesMore: 'Parādītas {shown} tuvākās no {total} vietām šajā rādiusā.',
    atmNote: 'Latvijas Bankas kartē atzīmēti kā krīzes (kritiskie) bankomāti.',
    shelterNote: 'Oficiālās patvertnes (VUGD / 112.lv). Trauksmes gadījumā dodieties uz tuvāko.',
    distance: 'Attālums', where: 'Vieta', coords: 'Koordinātas', from: 'Sākums', until: 'Aptuvenās beigas', source: 'Avots',
    estimated: 'aplēse', unknown: 'nav zināms', whatToDo: 'Ko darīt', reports: '{n} ziņojumi',
    srcPeople: 'Iedzīvotāju ziņojums', srcLVC: 'LVC (Latvijas Valsts ceļi)', srcLVGMC: 'LVĢMC',
    instructionsTitle: 'Kā rīkoties ārkārtas situācijā',
    instructions: [
      ['Vispārīgi', [
        'Saglabājiet mieru. Klausieties radio un sekojiet tikai oficiāliem norādījumiem.',
        'Ja dzirdat trauksmes sirēnas — dodieties telpās, aizveriet logus un durvis, ieslēdziet radio. Ja norādīts, dodieties uz tuvāko patvertni.',
        'Esiet gatavi 72 stundas iztikt bez ārējas palīdzības: dzeramais ūdens (vismaz 3 litri cilvēkam dienā), ilgi uzglabājama pārtika, nepieciešamās zāles, lukturis, radio ar baterijām, uzlādēta ārējā akumulatora baterija, skaidra nauda, dokumentu kopijas.',
        'Pierakstiet uz papīra tuvinieku tālruņu numurus un vienojieties par tikšanās vietu.',
      ]],
      ['Plūdi', ['Nebrauciet un neejiet pa applūdušu ceļu — jau 30 cm ūdens var aizskalot automašīnu.', 'Ja ūdens ieplūst mājā, atslēdziet elektrību un gāzi, pārvietojieties augstāk.']],
      ['Pārrauti elektrības vadi', ['Turieties vismaz 10 m attālumā un neļaujiet tuvoties citiem. Nepieskarieties vadiem un priekšmetiem, kas ar tiem saskaras.', 'Zvaniet 112 vai "Sadales tīkls" 8404.']],
      ['Kritis koks vai šķērslis uz ceļa', ['Brīdiniet citus satiksmes dalībniekus, neriskējiet ar apbraukšanu. Ja apdraudēta satiksme, zvaniet 112.']],
      ['Apledojums un sals', ['Samaziniet ātrumu, palieliniet distanci, ejot izmantojiet apavus ar neslīdošu zoli.', 'Pārbaudiet vientuļos kaimiņus un vecākus cilvēkus.']],
      ['Stiprs vējš un negaiss', ['Palieciet telpās, nenovietojiet automašīnu zem kokiem, nostipriniet vaļējus priekšmetus.']],
      ['Ceļu satiksmes negadījums', ['Ieslēdziet avārijas gaismas, uzvelciet atstarojošo vesti, izvietojiet avārijas zīmi.', 'Zvaniet 112 un, ja varat droši, sniedziet pirmo palīdzību.']],
      ['Elektrības pārtraukums', ['Atslēdziet elektroierīces no tīkla. Izmantojiet lukturi, nevis sveces. Nelietojiet ģeneratoru vai gāzes plīti apsildei telpās.']],
    ],
    moreInfo: 'Vairāk: 72stundas.lv (Valsts ugunsdzēsības un glābšanas dienests) un 112.lv.',
    sourcesTitle: 'Datu avoti',
    sources: 'LVĢMC brīdinājumi un prognozes (bridinajumi.meteo.lv, data.gov.lv); LVC ceļu notikumi (transportdata.gov.lv); VUGD patvertnes (112.lv); Latvijas Bankas bankomātu karte; viss.lv degvielas stacijas; iedzīvotāju ziņojumi; adreses — OpenStreetMap.',
    footer: 'Krīzes karte · izveidots {t} · informācija var būt novecojusi',
    page: 'lpp. {n}/{m}',
    dirs: ['Z', 'ZA', 'A', 'DA', 'D', 'DR', 'R', 'ZR'],
    levels: { yellow: 'Dzeltenais brīdinājums', orange: 'Oranžais brīdinājums', red: 'Sarkanais brīdinājums', medium: 'Vidējs risks', high: 'Augsts risks' },
  },
  en: {
    title: 'Crisis Map — offline copy',
    subtitle: 'Save it on your phone or print it. Useful when there is no internet.',
    generated: 'Created', location: 'Your location', radius: 'Radius',
    outdatedTitle: 'Information may be outdated',
    outdated: 'This document shows the situation at the time it was created. Things may change — when possible, check the website for current information or listen to the radio.',
    radio: 'No internet? Turn on the radio: {freq} · radio phone {rphone}. In a crisis, listen to official instructions.',
    numbersTitle: 'Key phone numbers',
    numbers: [
      ['112', 'Single emergency number (fire & rescue, police, ambulance) — free, works without a SIM card'],
      ['{phone}', 'Emergency service 24-hour toll-free line'],
      ['110', 'State Police'],
      ['113', 'Emergency medical service'],
      ['114', 'Gas emergency service'],
      ['8404', 'Sadales tīkls — power faults and downed lines'],
      ['66016001', 'Family doctors\' advice line (24 h)'],
      ['67042473', 'Poison and drug information centre'],
      ['116 111', 'Children and youth helpline'],
    ],
    mapTitle: 'Map: {km} km around your location',
    mapNote: 'The map shows hazards and up to {n} nearest places of each type. Labels match the lists further in the document.',
    mapUnavailable: 'The map could not be loaded — use the lists, directions and coordinates.',
    legYou: 'You', legHazard: 'Hazard / problem', legShelter: 'Shelter', legAtm: 'Crisis ATM', legFuel: 'Fuel station',
    legRadius: '{km} km radius', legRoad: 'Affected road section',
    codes: { shelter: 'S', atm: 'A', fuel: 'F' },
    forecastTitle: 'Forecast for the next 24 hours (critical information only)',
    forecastPlace: 'Nearest populated place: {place}',
    forecastNone: 'No critical weather expected.',
    hazardsTitle: 'Hazards and problems within {km} km',
    hazardsNone: 'At the time this document was created there were no known hazards or problems within {km} km.',
    sheltersTitle: 'Shelters', atmsTitle: 'Crisis ATMs', fuelTitle: 'Fuel stations',
    placesNone: 'No places found within {km} km.',
    placesMore: 'Showing the {shown} nearest of {total} places in this radius.',
    atmNote: 'Marked as crisis (critical) ATMs on the Latvijas Banka map.',
    shelterNote: 'Official shelters (VUGD / 112.lv). In an alert, go to the nearest one.',
    distance: 'Distance', where: 'Location', coords: 'Coordinates', from: 'Start', until: 'Estimated end', source: 'Source',
    estimated: 'estimate', unknown: 'unknown', whatToDo: 'What to do', reports: '{n} reports',
    srcPeople: 'Resident report', srcLVC: 'LVC (Latvian State Roads)', srcLVGMC: 'LVĢMC',
    instructionsTitle: 'What to do in an emergency',
    instructions: [
      ['General', [
        'Stay calm. Listen to the radio and follow official instructions only.',
        'If you hear alarm sirens — go indoors, close windows and doors, turn on the radio. If instructed, go to the nearest shelter.',
        'Be ready to manage for 72 hours without outside help: drinking water (at least 3 litres per person per day), long-life food, necessary medicines, a torch, a battery radio, a charged power bank, cash, copies of documents.',
        'Write down your family\'s phone numbers on paper and agree on a meeting point.',
      ]],
      ['Floods', ['Do not drive or walk through a flooded road — 30 cm of water can sweep a car away.', 'If water enters your home, switch off electricity and gas and move higher up.']],
      ['Downed power lines', ['Stay at least 10 m away and keep others away. Do not touch the lines or anything touching them.', 'Call 112 or Sadales tīkls 8404.']],
      ['Fallen tree or obstacle on the road', ['Warn other road users and do not take risks going around it. If traffic is endangered, call 112.']],
      ['Ice and frost', ['Slow down, keep more distance, wear shoes with non-slip soles.', 'Check on neighbours who live alone and older people.']],
      ['Strong wind and thunderstorms', ['Stay indoors, do not park under trees, secure loose objects.']],
      ['Road traffic accident', ['Switch on hazard lights, wear a reflective vest, set up the warning triangle.', 'Call 112 and, if safe, give first aid.']],
      ['Power cut', ['Unplug appliances. Use a torch, not candles. Never use a generator or gas stove for heating indoors.']],
    ],
    moreInfo: 'More: 72stundas.lv (State Fire and Rescue Service) and 112.lv.',
    sourcesTitle: 'Data sources',
    sources: 'LVĢMC warnings and forecasts (bridinajumi.meteo.lv, data.gov.lv); LVC road events (transportdata.gov.lv); VUGD shelters (112.lv); Latvijas Banka ATM map; viss.lv fuel stations; resident reports; addresses — OpenStreetMap.',
    footer: 'Crisis Map · created {t} · information may be outdated',
    page: 'page {n}/{m}',
    dirs: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    levels: { yellow: 'Yellow warning', orange: 'Orange warning', red: 'Red warning', medium: 'Medium risk', high: 'High risk' },
  },
};

const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : `{${k}}`));
const L = (obj, lang) => (obj ? obj[lang] || obj.lv || '' : '');

function rigaTime(iso, lang, withDate = true) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const opts = { timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit' };
  if (withDate) Object.assign(opts, { day: '2-digit', month: '2-digit', year: 'numeric' });
  // date-only values (e.g. "2026-10-22") have no time
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { delete opts.hour; delete opts.minute; }
  return d.toLocaleString(lang === 'en' ? 'en-GB' : 'lv-LV', opts);
}

function direction(fromLat, fromLon, lat, lon, lang) {
  const toRad = x => x * Math.PI / 180;
  const y = Math.sin(toRad(lon - fromLon)) * Math.cos(toRad(lat));
  const x = Math.cos(toRad(fromLat)) * Math.sin(toRad(lat)) - Math.sin(toRad(fromLat)) * Math.cos(toRad(lat)) * Math.cos(toRad(lon - fromLon));
  const deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return T[lang].dirs[Math.round(deg / 45) % 8];
}

const fmtDist = d => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1).replace('.', ',')} km`);
const fmtCoord = (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

/**
 * data = { lat, lon, radiusKm, lang, address, radio, phone, forecast, hazards: [{e, d}], places: { shelter, atm, fuel: {list:[{p,d,address}], total} } }
 */
function buildPdf(data, out) {
  const lang = data.lang === 'en' ? 'en' : 'lv';
  const t = T[lang];
  const created = rigaTime(new Date().toISOString(), lang);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 46, bottom: 56, left: 46, right: 46 }, bufferPages: true,
    info: { Title: t.title, Author: 'Krīzes karte' } });
  doc.registerFont('r', FONT);
  doc.registerFont('b', FONT_BOLD);
  doc.pipe(out);
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const X = doc.page.margins.left;

  const ensure = h => { if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage(); };
  const heading = (text, color = C.purple) => {
    ensure(120); // keep the heading together with its first item
    doc.moveDown(0.6);
    doc.font('b').fontSize(14).fillColor(color).text(text, X, doc.y, { width: W });
    const y = doc.y + 2;
    doc.moveTo(X, y).lineTo(X + W, y).lineWidth(1).strokeColor(C.line).stroke();
    doc.y = y + 6;
  };
  const para = (text, opts = {}) => {
    doc.font(opts.bold ? 'b' : 'r').fontSize(opts.size || 10).fillColor(opts.color || C.ink)
      .text(text, opts.x ?? X, doc.y, { width: opts.width ?? W, lineGap: 1.5 });
  };
  const box = (draw, color, bg) => {
    // measure by drawing into a temporary position, then paint background behind it
    const startY = doc.y, pad = 8;
    const h = draw(true);
    ensure(h + pad * 2 + 4);
    const y0 = doc.y;
    doc.save().roundedRect(X, y0, W, h + pad * 2, 6).fillAndStroke(bg, color).restore();
    doc.y = y0 + pad;
    draw(false, pad);
    doc.y = y0 + h + pad * 2 + 6;
    return startY;
  };
  const textHeight = (text, font, size, width) => { doc.font(font).fontSize(size); return doc.heightOfString(text, { width, lineGap: 1.5 }); };

  // ---------- header ----------
  doc.save().rect(0, 0, doc.page.width, 8).fill(C.purple).rect(0, 8, doc.page.width, 4).fill(C.green).restore();
  doc.y = 30;
  doc.font('b').fontSize(22).fillColor(C.ink).text(t.title, X, doc.y, { width: W });
  para(t.subtitle, { color: C.muted, size: 10.5 });
  doc.moveDown(0.5);
  const meta = [
    [t.generated, created],
    [t.location, `${data.address ? data.address + ' · ' : ''}${fmtCoord(data.lat, data.lon)}`],
    [t.radius, `${data.radiusKm} km`],
  ];
  for (const [k, v] of meta) {
    const y = doc.y;
    doc.font('b').fontSize(10).fillColor(C.muted).text(k + ':', X, y, { width: 130 });
    doc.font('b').fontSize(10).fillColor(C.ink).text(v, X + 130, y, { width: W - 130 });
    doc.moveDown(0.15);
  }
  doc.moveDown(0.5);

  // outdated warning
  const warnText = t.outdated;
  box((measure, pad = 8) => {
    const h1 = textHeight(t.outdatedTitle, 'b', 11, W - 20), h2 = textHeight(warnText, 'r', 9.5, W - 20);
    if (!measure) {
      doc.font('b').fontSize(11).fillColor(C.amber).text('! ' + t.outdatedTitle, X + 10, doc.y, { width: W - 20 });
      doc.font('r').fontSize(9.5).fillColor(C.ink).text(warnText, X + 10, doc.y, { width: W - 20, lineGap: 1.5 });
    }
    return h1 + h2 + 2;
  }, '#f3d27a', '#fffaea');

  // radio
  const radioText = fill(t.radio, { freq: data.radio, rphone: data.radioPhone });
  box(measure => {
    const h = textHeight(radioText, 'b', 11, W - 20);
    if (!measure) doc.font('b').fontSize(11).fillColor('#ffffff').text(radioText, X + 10, doc.y, { width: W - 20 });
    return h;
  }, C.purple, C.purple);

  // ---------- phone numbers ----------
  heading(t.numbersTitle, C.red);
  for (const [num, label] of t.numbers) {
    const n = fill(num, { phone: data.phone }), l = label;
    const h = Math.max(textHeight(l, 'r', 10, W - 90), 14);
    ensure(h + 4);
    const y = doc.y;
    doc.font('b').fontSize(12).fillColor(C.red).text(n, X, y, { width: 85 });
    doc.font('r').fontSize(10).fillColor(C.ink).text(l, X + 90, y + 1, { width: W - 90, lineGap: 1.5 });
    doc.y = y + h + 4;
  }

  // ---------- map ----------
  const PLACE_COLOR = { shelter: C.green, atm: C.purple, fuel: '#c2620a' };
  doc.addPage();
  heading(fill(t.mapTitle, { km: data.radiusKm }));
  drawMap();

  // ---------- forecast ----------
  heading(t.forecastTitle);
  const f = data.forecast;
  if (f?.city) para(fill(t.forecastPlace, { place: f.city.name }), { color: C.muted, size: 9.5 });
  if (!f || !f.items.length) para(t.forecastNone, { color: C.green, bold: true });
  for (const it of f?.items || []) {
    const level = it.capLevel ? t.levels[it.capLevel] : t.levels[it.level] || '';
    const when = it.from && new Date(it.from) > new Date()
      ? `${rigaTime(it.from, lang)} – ${rigaTime(it.until, lang)}` : rigaTime(it.until, lang);
    item(`${L(it.title, lang)}${level ? ' · ' + level : ''}`, [
      L(it.desc, lang),
      `${t.until}: ${when}`,
      it.official ? `${t.source}: LVĢMC — ${L(it.location, lang)}` : '',
      L(it.risks, lang) ? `${t.whatToDo}: ${L(it.risks, lang).replace(/\s*\n\s*/g, ' ')}` : '',
    ], it.capLevel ? C.amber : C.purple);
  }

  // ---------- hazards ----------
  heading(fill(t.hazardsTitle, { km: data.radiusKm }), C.red);
  if (!data.hazards.length) para(fill(t.hazardsNone, { km: data.radiusKm }), { color: C.green, bold: true });
  for (const [i, { e, d, address }] of data.hazards.entries()) {
    const src = e.src === 'people' ? t.srcPeople : e.src === 'LVC' ? t.srcLVC : t.srcLVGMC;
    const desc = L(e.desc, lang) && L(e.desc, lang) !== L(e.title, lang) ? L(e.desc, lang) : '';
    const loc = [address, L(e.location, lang)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
    const distTxt = d === 0 ? (lang === 'en' ? 'covers your location' : 'attiecas uz jūsu atrašanās vietu')
      : `${fmtDist(d)} ${direction(data.lat, data.lon, e.lat, e.lon, lang)}`;
    item(`${i + 1}. ${L(e.title, lang)}${e.count > 1 ? ' · ' + fill(t.reports, { n: e.count }) : ''}`, [
      desc,
      `${t.distance}: ${distTxt}`,
      loc ? `${t.where}: ${loc}` : '',
      e.geometry?.type === 'MultiPolygon' ? '' : `${t.coords}: ${fmtCoord(e.lat, e.lon)}`,
      e.from ? `${t.from}: ${rigaTime(e.from, lang)}` : '',
      `${t.until}: ${e.until ? rigaTime(e.until, lang) + (e.untilEstimated ? ` (${t.estimated})` : '') : t.unknown}`,
      `${t.source}: ${src}`,
      L(e.risks, lang) ? `${t.whatToDo}: ${L(e.risks, lang).replace(/\s*\n\s*/g, ' ')}` : '',
    ], e.src === 'people' ? C.purple : e.icon === 'closed' || e.icon === 'accident' ? C.red : C.green);
  }

  // ---------- places ----------
  const placeSection = (title, note, set, color, kind) => {
    heading(`${title} (${set.total})`, color);
    if (note) para(note, { color: C.muted, size: 9.5 });
    if (!set.list.length) { para(fill(t.placesNone, { km: data.radiusKm }), { color: C.muted }); return; }
    if (set.list.length < set.total) para(fill(t.placesMore, { shown: set.list.length, total: set.total }), { color: C.muted, size: 9 });
    doc.moveDown(0.2);
    set.list.forEach(({ p, d, address }, i) => {
      const details = L(p.details, lang);
      row(`${t.codes[kind]}${i + 1}`, L(p.name, lang), `${fmtDist(d)} ${direction(data.lat, data.lon, p.lat, p.lon, lang)}`,
        [address || p.address || '', details, `${t.coords}: ${fmtCoord(p.lat, p.lon)}`].filter(Boolean), color);
    });
  };
  placeSection(t.sheltersTitle, t.shelterNote, data.places.shelter, PLACE_COLOR.shelter, 'shelter');
  placeSection(t.atmsTitle, t.atmNote, data.places.atm, PLACE_COLOR.atm, 'atm');
  placeSection(t.fuelTitle, '', data.places.fuel, PLACE_COLOR.fuel, 'fuel');

  // ---------- instructions ----------
  doc.addPage();
  heading(t.instructionsTitle, C.red);
  for (const [title, lines] of t.instructions) {
    ensure(40);
    doc.font('b').fontSize(11).fillColor(C.ink).text(title, X, doc.y, { width: W });
    for (const l of lines) {
      const h = textHeight(l, 'r', 10, W - 14);
      ensure(h + 2);
      const y = doc.y;
      doc.font('b').fontSize(10).fillColor(C.green).text('•', X + 2, y);
      doc.font('r').fontSize(10).fillColor(C.ink).text(l, X + 14, y, { width: W - 14, lineGap: 1.5 });
    }
    doc.moveDown(0.4);
  }
  para(t.moreInfo, { bold: true, color: C.purple });
  heading(t.sourcesTitle, C.muted);
  para(t.sources, { size: 9, color: C.muted });

  // ---------- footer on every page ----------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 38;
    doc.save().moveTo(X, y - 6).lineTo(X + W, y - 6).lineWidth(0.5).strokeColor(C.line).stroke().restore();
    doc.font('r').fontSize(8).fillColor(C.muted)
      .text(fill(t.footer, { t: created }), X, y, { width: W - 80, lineBreak: false, height: 12 });
    doc.text(fill(t.page, { n: i + 1, m: range.count }), X + W - 80, y, { width: 80, align: 'right', lineBreak: false, height: 12 });
  }
  doc.end();

  // a titled item with a coloured side bar
  function item(title, lines, color) {
    lines = lines.filter(Boolean);
    const h = textHeight(title, 'b', 11, W - 14) + lines.reduce((s, l) => s + textHeight(l, 'r', 9.5, W - 14), 0) + 6;
    ensure(Math.min(h, 200));
    const y0 = doc.y, pages = doc.bufferedPageRange().count;
    doc.font('b').fontSize(11).fillColor(C.ink).text(title, X + 12, doc.y, { width: W - 14 });
    for (const l of lines) doc.font('r').fontSize(9.5).fillColor(C.ink).text(l, X + 12, doc.y, { width: W - 14, lineGap: 1.5 });
    const y1 = doc.y;
    // side bar only when the item did not break across pages
    if (doc.bufferedPageRange().count === pages) doc.save().rect(X, y0 + 1, 3.5, Math.max(10, y1 - y0 - 2)).fill(color).restore();
    doc.y = y1 + 7;
  }

  // a numbered place row: name + distance on the first line, details below
  function row(n, name, dist, lines, color) {
    const h = textHeight(name, 'b', 10.5, W - 120) + lines.reduce((s, l) => s + textHeight(l, 'r', 9, W - 30), 0) + 6;
    ensure(h);
    const y = doc.y;
    label(n, X + 13, y + 7, color);
    doc.font('b').fontSize(10.5).fillColor(C.ink).text(name, X + 30, y, { width: W - 126 });
    doc.font('b').fontSize(10).fillColor(color).text(dist, X + W - 92, y, { width: 92, align: 'right' });
    doc.y = Math.max(doc.y, y + 14);
    for (const l of lines) doc.font('r').fontSize(9).fillColor(C.muted).text(l, X + 30, doc.y, { width: W - 36, lineGap: 1 });
    doc.y += 5;
  }

  // small rounded label centred on (cx, cy) — same look on the map and in the lists
  function label(text, cx, cy, color) {
    doc.font('b').fontSize(7.5);
    const w = Math.max(14, doc.widthOfString(text) + 7), h = 13;
    doc.save().roundedRect(cx - w / 2, cy - h / 2, w, h, 6.5).lineWidth(1.2).fillAndStroke(color, '#ffffff').restore();
    doc.font('b').fontSize(7.5).fillColor('#ffffff').text(text, cx - w / 2, cy - 4.6, { width: w, align: 'center', lineBreak: false });
  }

  function drawMap() {
    const m = data.map;
    const size = W, x0 = X, y0 = doc.y, s = size / (m?.boxPx || 1000);
    if (!m || !m.tiles.length) {
      para(t.mapUnavailable, { color: C.muted });
      return;
    }
    const pt = (lat, lon) => { const [px, py] = m.project(lat, lon); return [x0 + px * s, y0 + py * s]; };
    const inside = ([x, y]) => x >= x0 + 4 && x <= x0 + size - 4 && y >= y0 + 4 && y <= y0 + size - 4;

    doc.save();
    doc.rect(x0, y0, size, size).clip();
    for (const tl of m.tiles) {
      try { doc.image(tl.buf, x0 + tl.left * s, y0 + tl.top * s, { width: 256 * s, height: 256 * s }); } catch { /* bad tile */ }
    }
    // soften the base map a little so markers stand out
    doc.rect(x0, y0, size, size).fillOpacity(0.12).fill('#ffffff').fillOpacity(1);

    // radius circle
    const [cx, cy] = pt(data.lat, data.lon);
    doc.circle(cx, cy, m.radiusPx * s).lineWidth(1.6).dash(5, { space: 4 }).strokeColor(C.purple).stroke().undash();

    // affected road sections
    for (const { e } of data.hazards) {
      if (e.geometry?.type !== 'MultiLineString') continue;
      const col = e.icon === 'closed' || e.icon === 'accident' ? C.red : '#e8590c';
      for (const line of e.geometry.coordinates) {
        line.forEach(([lon, lat], k) => { const [x, y] = pt(lat, lon); k ? doc.lineTo(x, y) : doc.moveTo(x, y); });
        doc.lineWidth(3.5).strokeOpacity(0.85).strokeColor(col).stroke().strokeOpacity(1);
      }
    }

    // places (nearest few per kind), then hazards on top, then "you"
    for (const kind of ['fuel', 'atm', 'shelter']) {
      data.places[kind].list.slice(0, data.mapPerKind).forEach(({ p }, i) => {
        const q = pt(p.lat, p.lon);
        if (inside(q)) label(`${t.codes[kind]}${i + 1}`, q[0], q[1], PLACE_COLOR[kind]);
      });
    }
    data.hazards.forEach(({ e }, i) => {
      if (e.geometry?.type === 'MultiPolygon') return;
      const q = pt(e.lat, e.lon);
      if (inside(q)) label(String(i + 1), q[0], q[1], C.red);
    });
    doc.circle(cx, cy, 7).lineWidth(2.5).fillAndStroke(C.purple, '#ffffff');
    doc.font('b').fontSize(8.5).fillColor(C.purple).text(t.legYou, cx + 10, cy - 5, { lineBreak: false });
    doc.restore();

    // frame + attribution
    doc.rect(x0, y0, size, size).lineWidth(1).strokeColor(C.line).stroke();
    doc.save().rect(x0 + size - 132, y0 + size - 12, 132, 12).fillOpacity(0.8).fill('#ffffff').restore();
    doc.font('r').fontSize(7).fillColor(C.muted).text('© OpenStreetMap contributors', x0 + size - 128, y0 + size - 10, { lineBreak: false });
    doc.y = y0 + size + 8;

    // legend
    const items = [
      [() => doc.circle(0, 0, 5).lineWidth(2).fillAndStroke(C.purple, '#ffffff'), t.legYou],
      [() => label('1', 0, 0, C.red), t.legHazard],
      [() => label(`${t.codes.shelter}1`, 0, 0, PLACE_COLOR.shelter), t.legShelter],
      [() => label(`${t.codes.atm}1`, 0, 0, PLACE_COLOR.atm), t.legAtm],
      [() => label(`${t.codes.fuel}1`, 0, 0, PLACE_COLOR.fuel), t.legFuel],
      [() => doc.moveTo(-8, 0).lineTo(8, 0).lineWidth(3.5).strokeColor('#e8590c').stroke(), t.legRoad],
      [() => doc.circle(0, 0, 6).lineWidth(1.4).dash(3, { space: 2 }).strokeColor(C.purple).stroke().undash(), fill(t.legRadius, { km: data.radiusKm })],
    ];
    const colW = W / 4, baseY = doc.y;
    items.forEach(([draw, text], k) => {
      const lx = X + (k % 4) * colW, ly = baseY + Math.floor(k / 4) * 18;
      doc.save().translate(lx + 12, ly + 6); draw(); doc.restore();
      doc.font('r').fontSize(8.5).fillColor(C.ink).text(text, lx + 26, ly + 1, { width: colW - 28, lineBreak: false });
    });
    doc.y = baseY + Math.ceil(items.length / 4) * 18 + 4;
    para(fill(t.mapNote, { n: data.mapPerKind }), { color: C.muted, size: 9 });
  }
}

module.exports = { buildPdf };
