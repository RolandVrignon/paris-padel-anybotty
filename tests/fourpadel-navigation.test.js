import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { openFourPadelCalendar, installFourPadelPreviewGuard } from '../lib/fourpadel-booking.js'

const names = { 117: '4PADEL Saint-Ouen', 105: '4PADEL Boulogne-Billancourt' }
const fixture = (calendar = false, wrongLabel = false) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="lf-local-bar-center-info"><img alt="4Padel club" onclick="document.querySelector('#centers-dropdown-modal').hidden=false">
<div class="lf-local-bar-center-info-btns"><a id="club-link"><div class="lf-local-bar-info-btn"></div></a></div></div>
<div id="centers-dropdown-modal" hidden><span onclick="selectClub(117)">4PADEL Saint-Ouen</span><span onclick="selectClub(105)">4PADEL Boulogne-Billancourt</span></div>
<button onclick="document.querySelector('[role=menu]').hidden=false">Que souhaites-tu faire</button>
<div role="menu" hidden><span onclick="location.href='/reservations/slots'">Réserver une piste</span></div>
<p onclick="throw new Error('Wrong reserve action')">Réserver une piste</p>
<div>4PADEL Boulogne-Billancourt</div>
<script>
const names=${JSON.stringify(names)};
function selectClub(id){localStorage.setItem('center', id);document.querySelector('#centers-dropdown-modal').hidden=true;render()}
function render(){const id=Number(localStorage.getItem('center')||117);document.querySelector('#club-link').href='/nos-centres/'+id+'/club';document.querySelector('.lf-local-bar-info-btn').textContent=names[id]}
render();
${calendar ? `const id=Number(localStorage.getItem('center')||117);const b=document.createElement('button');b.textContent='Club '+names[${wrongLabel ? '117' : 'id'}];document.body.append(b);
fetch('https://api2-front.lefive.fr/bookingrules/me/visibility',{method:'POST'});
fetch('https://api2-front.lefive.fr/bookingrules/allFields',{method:'POST',body:JSON.stringify({center:id})});` : ''}
</script></body></html>`

const setup = async (t, { wrongLabel = false, wrongCenter = false } = {}) => {
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const centers = []
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = { 'access-control-allow-origin': '*' }
    if (url.origin === 'https://api2-front.lefive.fr') {
      if (url.pathname.endsWith('/allFields')) {
        const center = request.postDataJSON().center
        centers.push(center)
        return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify([{ fields: [{ center: { id: wrongCenter ? 117 : center } }] }]) })
      }
      return route.fulfill({ headers, contentType: 'application/json', body: '{}' })
    }
    return route.fulfill({ contentType: 'text/html', body: fixture(url.pathname === '/reservations/slots', wrongLabel) })
  })
  await installFourPadelPreviewGuard(context)
  const page = await context.newPage()
  page.setDefaultTimeout(3000)
  return { page, centers }
}

test('home navigation changes the default club before reserving despite duplicate labels elsewhere', async t => {
  const { page, centers } = await setup(t)
  await openFourPadelCalendar(page, '4padel-boulogne')
  assert.deepEqual(centers, [105])
  assert.equal(await page.locator('#club-link').getAttribute('href'), '/nos-centres/105/club')
  // Repeat with the selected club, then switch back: no reliance on the profile default.
  await openFourPadelCalendar(page, '4padel-boulogne')
  await openFourPadelCalendar(page, '4padel-saint-ouen')
  assert.deepEqual(centers, [105, 105, 117])
})

test('a calendar label for the wrong club stops navigation', async t => {
  const { page } = await setup(t, { wrongLabel: true })
  await assert.rejects(openFourPadelCalendar(page, '4padel-boulogne'), /requested club/)
})

test('correct UI label with wrong server center stops navigation', async t => {
  const { page } = await setup(t, { wrongCenter: true })
  await assert.rejects(openFourPadelCalendar(page, '4padel-boulogne'), /requested center/)
})
