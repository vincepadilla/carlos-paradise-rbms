import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Browser-only fixtures. Laravel persistence and authorization are tested separately in OwnerPortalTest.
export function ownerFixtureResponse(url, options, state) {
    const path = url.pathname;
    if (!path.startsWith('/api/owner/') || path.startsWith('/api/owner/operations/')) return null;
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    const page = data => ({ data, total: data.length, current_page: 1, last_page: 1 });
    const save = () => sessionStorage.setItem('rbms-admin-test', JSON.stringify(state));
    state.ownerSettings ??= { name: 'Test Resort', contact: 'Fixture contact', address: 'Fixture address', description: 'Private villa', deposit: 5000, opportunity_hours: 24, min_lead_days: 2, check_in_time: '14:00', check_out_time: '11:00', standard_guests: 20, max_guests: 40 };
    if (path === '/api/owner/settings') {
        if (options.method === 'PATCH') { Object.assign(state.ownerSettings, JSON.parse(options.body)); save(); }
        return json({ settings: state.ownerSettings });
    }
    state.ownerAdmins ??= [{ id: 5, name: 'Operations Admin', email: 'operations@example.test', is_active: true, created_at: new Date().toISOString() }];
    if (path === '/api/owner/admins' && options.method === 'POST') {
        const { password, ...data } = JSON.parse(options.body);
        const admin = { ...data, id: 6, is_active: true, created_at: new Date().toISOString() };
        state.ownerAdmins.push(admin); save(); return json({ admin }, 201);
    }
    if (/^\/api\/owner\/admins\/\d+$/.test(path) && options.method === 'PATCH') {
        const admin = state.ownerAdmins.find(row => row.id === Number(path.split('/').at(-1)));
        Object.assign(admin, JSON.parse(options.body)); save(); return json({ admin });
    }
    if (path === '/api/owner/admins') {
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        return json(page(state.ownerAdmins.filter(row => `${row.name} ${row.email}`.toLowerCase().includes(search))));
    }
    if (path === '/api/owner/documents') {
        const key = options.body instanceof FormData ? options.body.get('key') : url.searchParams.get('key');
        state.documents ??= {};
        state.documents[key] ??= [];
        const versions = state.documents[key];
        if (options.method === 'POST') {
            const file = options.body.get('file');
            versions.unshift({ id: versions.length + 1, version: versions.length + 1, original_name: file.name, size: file.size, notes: options.body.get('notes'), sha256: 'fixture', created_at: new Date().toISOString(), uploaded_by: 'Test Owner' });
            save();
        }
        return json({ active_version_id: versions[0]?.id ?? null, versions });
    }
    if (path === '/api/owner/payment-methods') return json({ payment_methods: [] });
    if (path === '/api/owner/audit-trail') return json({ ...page([{ id: 1, source: 'audit', occurred_at: new Date().toISOString(), user_name: 'Test Owner', role: 'owner', action: 'settings_updated', module: 'System Settings', details: 'Updated deposit.' }]), filters: { modules: ['System Settings'], actions: ['settings_updated'] }, integrity: 'Standard application history; cryptographic audit chaining is not implemented.' });
    if (path === '/api/owner/database/backup') return json({ format: 'carlos-paradise-application-export', version: 1, tables: {} });
    if (path === '/api/owner/database/validate') return json({ tables: { roles: 3, users: 4 }, restore_supported: false, message: 'Export format recognized. Automatic restore is unavailable. No records were changed.' });
    return json({ message: 'Unimplemented Owner browser fixture' }, 404);
}

export async function runOwnerChecks({ visit, navigate, evaluate, until, heading, passed, cdp, screenshot, runtimeErrors }) {
    const fill = async (selector, value) => evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); const proto=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true})); })()`);
    const click = text => evaluate(`[...document.querySelectorAll('button')].find(button=>button.checkVisibility()&&button.textContent.trim()===${JSON.stringify(text)}).click()`);
    const setFile = async (selector, filename) => {
        const { root } = await cdp('DOM.getDocument');
        const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector });
        await cdp('DOM.setFileInputFiles', { nodeId, files: [filename] });
    };
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await visit('/owner/dashboard', { role: 'owner', adminName: 'Test Owner' });
    await heading('Welcome back, Owner!');
    assert.equal(await evaluate("document.querySelector('.admin-portal-label').textContent"), 'OWNER PORTAL');
    assert.equal(await evaluate("document.querySelector('.admin-profile').textContent"), 'Test OwnerOwner');
    assert.equal(await evaluate("document.querySelectorAll('.admin-sidebar nav a').length"), 10);
    assert.equal(await evaluate("[...document.querySelectorAll('.admin-sidebar nav a')].every(a=>a.pathname.startsWith('/owner/'))"), true);
    passed('Owner session renders the Owner identity and all ten navigation entries');

    await evaluate(`window.__ownerShell=document.querySelector('.admin-shell');window.__ownerAuthCount=window.__adminQA.requests.filter(r=>r.path==='/auth/user').length;window.__ownerFlash=false;window.__ownerObserver=new MutationObserver(()=>{if(document.body.textContent.includes('Checking your session')||!window.__ownerShell.isConnected)window.__ownerFlash=true;});window.__ownerObserver.observe(document.querySelector('#root'),{subtree:true,childList:true});document.querySelector('.admin-sidebar a[href="/owner/guests"]').click()`);
    await heading('Guests');
    await until("Boolean(document.querySelector('#admin-content a[href=\"/owner/guests/2\"]'))");
    await evaluate("document.querySelector('#admin-content a[href=\"/owner/guests/2\"]').click()");
    await heading('Guest Details');
    assert.equal(await evaluate("window.__ownerFlash"), false);
    assert.equal(await evaluate("window.__adminQA.requests.filter(r=>r.path==='/auth/user').length===window.__ownerAuthCount"), true);
    assert.equal(await evaluate("window.__adminQA.requests.some(r=>r.path==='/api/owner/operations/guests/2')"), true);
    await evaluate('window.__ownerObserver.disconnect()');
    passed('Shared guest pages stay in the Owner portal without remounting the session or shell');

    for (const [path, title] of [['reservations', 'Reservations'], ['calendar', 'Centralized Calendar'], ['reports', 'Reports'], ['notifications', 'Notification Center'], ['reservations/1', 'Reservation Details'], ['reservations/1/payment-review', 'Deposit Verification']]) {
        await navigate(`/owner/${path}`); await heading(title);
        await until("!document.querySelector('#admin-content [role=status]')");
        assert.equal(await evaluate("Boolean(document.querySelector('#admin-content [role=alert]'))"), false);
        assert.equal(await evaluate("[...document.querySelectorAll('#admin-content a')].filter(a=>a.origin===location.origin).some(a=>a.pathname.startsWith('/admin/'))"), false);
        passed(`Owner shares operational page ${path}`);
    }

    await navigate('/owner/settings?section=Reservation+Settings'); await heading('System Settings');
    await until("Boolean(document.querySelector('[name=deposit]'))");
    await fill('[name=deposit]', '6500'); await fill('[name=opportunity_hours]', '36'); await fill('[name=check_in_time]', '15:30');
    await click('Save Changes'); await until("document.querySelector('.owner-notice')?.textContent.includes('Settings saved')");
    await navigate('/owner/settings?section=Reservation+Settings');
    await until("document.querySelector('[name=deposit]')?.value==='6500'");
    assert.equal(await evaluate("document.querySelector('[name=check_in_time]').value"), '15:30');
    assert.equal(await evaluate("document.querySelectorAll('.owner-settings-stack > details').length"), 10);
    passed('Owner settings submit real API requests and restore saved values after refresh (browser fixtures)');
    await screenshot('owner-settings-desktop');

    await navigate('/owner/admin-management'); await heading('Admin Management');
    await until("document.querySelector('tbody')?.textContent.includes('Operations Admin')");
    await click('+ Add Admin'); await until("Boolean(document.querySelector('dialog[open]'))");
    await fill('dialog [name=name]', 'New Admin'); await fill('dialog [name=email]', 'new@example.test'); await fill('dialog [name=password]', 'SecurePassword123');
    await click('Add Admin'); await until("!document.querySelector('dialog[open]') && document.querySelector('tbody')?.textContent.includes('New Admin')");
    await evaluate("[...document.querySelectorAll('tbody tr')].find(row=>row.textContent.includes('New Admin')).querySelector('button').click()");
    await fill('dialog [name=name]', 'Updated Admin'); await click('Save Changes');
    await until("!document.querySelector('dialog[open]') && document.querySelector('tbody')?.textContent.includes('Updated Admin')");
    await evaluate("[...document.querySelectorAll('tbody tr')].find(row=>row.textContent.includes('Updated Admin')).querySelectorAll('button')[1].click()");
    await click('Confirm'); await until("!document.querySelector('dialog[open]') && [...document.querySelectorAll('tbody tr')].find(row=>row.textContent.includes('Updated Admin'))?.textContent.includes('Disabled')");
    passed('Admin creation, editing, and confirmed disable actions update the displayed accounts');
    await screenshot('owner-admins-desktop');

    const temp = resolve('node_modules/.tmp/owner-qa'); await mkdir(temp, { recursive: true });
    const pdf = resolve(temp, 'agreement.pdf'); await writeFile(pdf, '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
    await navigate('/owner/settings?section=Document+Management');
    await until("Boolean(document.querySelector('input[type=file]'))");
    for (const version of [1, 2]) {
        await setFile('input[type=file]', pdf); await fill('.owner-document-card [name=notes]', `Version ${version}`); await click('Upload as New Active Version');
        await until(`document.querySelector('.owner-document-active')?.textContent.includes('Version ${version}') && !document.querySelector('button[disabled]')?.textContent.includes('Uploading')`);
    }
    assert.equal(await evaluate("document.querySelectorAll('.owner-version-row').length"), 2);
    assert.equal(await evaluate("document.querySelectorAll('.owner-version-row a').length"), 4);
    passed('PDF replacement creates an active version while retaining previous preview and download links');

    await navigate('/owner/audit-trail'); await heading('Audit Trail');
    await until("document.querySelector('tbody')?.textContent.includes('Updated deposit.')");
    await fill('input[type=search]', 'deposit');
    await fill('input[type=date]', '2026-11-11');
    await fill('select', 'System Settings');
    await click('Apply Filters');
    await until("window.__adminQA.requests.some(r=>r.path==='/api/owner/audit-trail'&&r.query.includes('module=System+Settings')&&r.query.includes('search=deposit')&&r.query.includes('date=2026-11-11'))");
    assert.equal(await evaluate("document.body.textContent.includes('cryptographic audit chaining is not implemented')"), true);
    passed('Audit filters reach the API and the page accurately describes logging integrity');
    await screenshot('owner-audit-desktop');

    await navigate('/owner/database'); await heading('Database');
    const json = resolve(temp, 'backup.json'); await writeFile(json, JSON.stringify({ format: 'carlos-paradise-application-export', version: 1, tables: { roles: [{ id: 1 }] } }));
    await setFile('input[type=file]', json); await click('Validate Backup'); await until("document.body.textContent.includes('No records were changed.')");
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Restore Backup').disabled"), true);
    passed('Backup selection validates the export and automatic restore remains explicitly disabled');
    await screenshot('owner-database-desktop');

    for (const width of [390, 768]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
        for (const path of ['database', 'admin-management', 'settings?section=Document+Management', 'audit-trail']) {
            await navigate(`/owner/${path}`); await until("Boolean(document.querySelector('.owner-card,.owner-settings-stack')) && !document.querySelector('#admin-content [role=status]')");
            assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, `No document overflow at ${width}px on ${path}`);
        }
        await screenshot(`owner-audit-${width}`);
        await evaluate("document.querySelector('.admin-menu-toggle').click()");
        await until("Boolean(document.querySelector('.admin-sidebar-open'))");
        assert.equal(await evaluate("document.querySelectorAll('.admin-sidebar nav a').length"), 10);
        passed(`Owner pages and navigation remain usable at ${width}px`);
    }
    for (const [role, destination] of [['guest', '/'], ['admin', '/admin/dashboard'], ['anonymous', '/login']]) {
        await visit('/owner/admin-management', { role }); await until(`location.pathname===${JSON.stringify(destination)}`);
        assert.equal(await evaluate("Boolean(document.querySelector('.owner-page'))"), false);
        passed(`Owner frontend guard rejects ${role}`);
    }
    await visit('/', { role: 'owner' }); await heading('Welcome back, Owner!');
    assert.equal(await evaluate('location.pathname'), '/owner/dashboard');
    await navigate('/dashboard'); await heading('Welcome back, Owner!');
    assert.equal(await evaluate('location.pathname'), '/owner/dashboard');
    passed('Restored Owner sessions route to the Owner dashboard from customer entry points');
    assert.deepEqual(runtimeErrors, [], 'No unhandled browser exceptions');
}
