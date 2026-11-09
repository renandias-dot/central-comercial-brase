// Lê o endereço iCal de uma agenda do Google (secreto ou público) e devolve os compromissos de uma janela de datas,
// já com repetições, exceções e fusos horários resolvidos. A biblioteca ical.js entra por parâmetro para o código ser testável.
export type CalEvent = { s: string; e: string; ad?: boolean; t?: string };

// O Google nem sempre inclui a definição do fuso de Brasília; ele não tem horário de verão desde 2019, então vale UTC-3 fixo.
const SAO_PAULO = 'BEGIN:VTIMEZONE\r\nTZID:America/Sao_Paulo\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:-0300\r\nTZOFFSETTO:-0300\r\nTZNAME:-03\r\nEND:STANDARD\r\nEND:VTIMEZONE';

// O endereço público do Google traz todos os eventos de anos (milhares, já com as repetições abertas). Interpretar tudo
// gasta tempo de CPU à toa, então, antes de usar a biblioteca, descartamos no texto os eventos fora da janela.
// Eventos com regra de repetição (RRULE) sempre ficam. Sem expressões regulares, só buscas de texto.
export function trimIcs(text: string, fromMs: number, toMs: number): string {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const lo = day(fromMs - 2 * 864e5), hi = day(toMs + 2 * 864e5);
  const BEGIN = 'BEGIN:VEVENT', END = 'END:VEVENT';
  const first = text.indexOf(BEGIN);
  if (first < 0) return text;
  const out: string[] = [text.slice(0, first)];
  // AAAAMMDD do valor de uma propriedade do bloco (ou '' se não existir).
  const dateOf = (b: string, prop: string) => {
    const i = b.indexOf(prop);
    if (i < 0) return '';
    const nl = b.indexOf('\n', i + 1), line = b.slice(i, nl < 0 ? b.length : nl), c = line.indexOf(':');
    return c < 0 ? '' : line.slice(c + 1, c + 9);
  };
  let pos = first, last = first;
  while (pos >= 0) {
    const e = text.indexOf(END, pos);
    if (e < 0) break;
    last = e + END.length;
    const b = text.slice(pos, last);
    if (b.includes('\nRRULE') || [dateOf(b, '\nDTSTART'), dateOf(b, '\nDTEND'), dateOf(b, '\nRECURRENCE-ID')].some(d => d >= lo && d <= hi)) out.push(b + '\r\n');
    pos = text.indexOf(BEGIN, last);
  }
  out.push(text.slice(last).replace(/^[\r\n]+/, ''));
  return out.join('');
}

export function parseIcs(ICAL: any, text: string, fromMs: number, toMs: number, withTitles = false): CalEvent[] {
  const jcal = ICAL.parse(trimIcs(text, fromMs, toMs)), root = new ICAL.Component(jcal);
  const known = new Set<string>();
  for (const tz of root.getAllSubcomponents('vtimezone')) { ICAL.TimezoneService.register(tz); known.add(String(tz.getFirstPropertyValue('tzid'))); }
  if (!known.has('America/Sao_Paulo')) ICAL.TimezoneService.register(new ICAL.Component(ICAL.parse(SAO_PAULO)));

  const masters = new Map<string, any>(), exceptions: any[] = [], singles: any[] = [];
  for (const v of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(v);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) { const m = masters.get(ex.uid); if (m) m.relateException(ex); else singles.push(ex); }

  const out: CalEvent[] = [];
  const keep = (ev: any, start: any, end: any) => {
    const v = ev.component;
    if (String(v.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    if (String(v.getFirstPropertyValue('transp') ?? '').toUpperCase() === 'TRANSPARENT') return; // marcado como "livre"
    const allDay = !!start.isDate, s = start.toJSDate(), e = end ? end.toJSDate() : s;
    if (+e < fromMs || +s > toMs) return;
    const row: CalEvent = allDay ? { s: start.toString(), e: (end || start).toString(), ad: true } : { s: s.toISOString(), e: (+e > +s ? e : new Date(+s + 30 * 60e3)).toISOString() };
    if (withTitles) row.t = String(ev.summary ?? '').slice(0, 120);
    out.push(row);
  };
  for (const ev of [...masters.values(), ...singles]) {
    if (!ev.isRecurring()) { keep(ev, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    for (let n = 0, next = it.next(); next && n < 2000; next = it.next(), n++) {
      if (+next.toJSDate() > toMs) break;
      const d = ev.getOccurrenceDetails(next);
      keep(d.item, d.startDate, d.endDate);
    }
  }
  return out.sort((a, b) => a.s.localeCompare(b.s));
}
