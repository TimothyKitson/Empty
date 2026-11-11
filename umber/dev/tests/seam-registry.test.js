const { run } = require('../harness');

run('bus delivers events and survives a throwing listener', async (h, t) => {
  const out = await h.eval(() => {
    const seen = [];
    const off = window.seam.bus.on('ping', (d) => seen.push(d.n));
    window.seam.bus.on('ping', () => { throw new Error('listener failure'); });
    window.seam.bus.emit('ping', { n: 1 });
    off();
    window.seam.bus.emit('ping', { n: 2 });
    return seen;
  });
  t.eq(out, [1]);
}, { page: 'dev/pages/seam.html', allowErrors: true });

run('registry orders entries and announces registrations', async (h, t) => {
  const out = await h.eval(() => {
    const events = [];
    window.seam.bus.on('registry:change', (d) => events.push(d.kind + ':' + d.id));
    const r = new window.seam.Registry('demo');
    r.register({ id: 'b', order: 2 });
    r.register({ id: 'a', order: 1 });
    r.register({ id: 'c' });
    return { ids: r.list().map((x) => x.id), has: r.has('a'), missing: r.get('zzz'), events };
  });
  t.eq(out.ids, ['a', 'b', 'c']);
  t.eq(out.has, true);
  t.eq(out.missing, null);
  t.eq(out.events, ['demo:b', 'demo:a', 'demo:c']);
}, { page: 'dev/pages/seam.html' });
