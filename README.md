# Boodschappenbrein 1.0

Nederlandstalige webapp die uit uw eigen kassabonnen berekent waar het boodschappengeld naartoe gaat,
voorspelt wat bijna op is, en vergelijkt waar de lijst het voordeligst is. Alle gegevens blijven in de
browser op uw apparaat (IndexedDB). Geen account, geen server, geen tracking.

## Starten

Er is **geen installatie en geen build-stap** nodig. Kies één van deze manieren:

```bash
# met Node.js (18 of nieuwer)
node server.mjs            # → http://localhost:8080

# of met Python
python3 -m http.server 8080
```

Open daarna `http://localhost:8080`. Dubbelklikken op `index.html` werkt níet (browsers blokkeren
modules vanaf `file://`).

**Op de iPhone gebruiken.** `node server.mjs` toont ook een adres in uw thuisnetwerk
(bv. `http://192.168.1.20:8080`). Let op: iOS bewaart gegevens per adres, en op `http://` kan
Safari de app niet als echte app installeren. Voor dagelijks gebruik op de telefoon is het het
handigst om de map op een gratis statische host met `https` te zetten (GitHub Pages, Netlify,
Cloudflare Pages). Dat is veilig: de host levert alleen de programmabestanden; uw bonnen blijven op
uw telefoon. Daarna in Safari: Deel → *Zet op beginscherm*.

Elk apparaat heeft zijn eigen database. Gebruik **Instellingen → Back-up** om gegevens over te zetten.

## Tests

```bash
node --test tests/*.test.js     # 58 tests: parser, dubbele imports, analyse, voorraad, besparing, zoeken, prijzen, back-up
```

## Wat werkt (en wat niet)

| Onderdeel | Status |
|---|---|
| Importeren van bonnen als **tekst-PDF**, **schermafbeelding/foto** (OCR), **CSV**, **Excel**, **JSON**, geplakte tekst | Werkt. Meerdere bestanden tegelijk. |
| Herkenning van winkel, datum, aantal, gewicht, inhoud, prijs, korting, statiegeld, retour, totaal | Werkt voor gangbare bonvormen (AH, Jumbo, Lidl en vergelijkbaar). Elke bon gaat langs een controlescherm met totaalcontrole. |
| Dubbele imports | Geblokkeerd op bestand (SHA-256) én op bon (winkel/datum/bedrag/regels). |
| Import terugdraaien, bon verwijderen | Werkt, inclusief opruimen van producten die alleen door die import bestonden. |
| Productgeheugen (afkortingen, merken, inhoud), leren van correcties, samenvoegen | Werkt. |
| Dashboard, analyse per week/maand/jaar/winkel/product/merk/categorie, producthistorie | Werkt. Feiten, schattingen en voorspellingen zijn gelabeld. |
| Voorspellende voorraad (4 modellen, vakanties, één-tik-correctie die het tempo bijstuurt) | Werkt. Bij te weinig/onregelmatige data: "Onvoldoende gegevens". |
| Boodschappenlijst met suggesties, favorieten, groepering, delen | Werkt. Delen via tekst of link; **geen live synchronisatie**. |
| Besparingsadviseur | Werkt alleen met ≥ 1 maand data; gerealiseerd vs. theoretisch apart. |
| Slimme zoekfunctie | Werkt zonder AI, op trefwoorden; rekent exact uit eigen data. |
| Prijsvergelijking | Werkt met de open data van Checkjebon.nl (zie onder). |
| Weekmenu | Basisversie: gerechten, weekplanning, ingrediënten naar lijst (overslaan wat waarschijnlijk in huis is), geschatte kosten. |
| Wekelijkse aanbiedingen | Werkt via GitHub (zie LEESMIJ.md); bronnen onofficieel. |
| Optionele AI-assistent, synchronisatie tussen gezinsleden | **Niet gebouwd** (fase 3). Synchronisatie vereist een server of gedeelde opslag. |

### Externe onderdelen

| Functie | Wat wordt geladen | Uw gegevens |
|---|---|---|
| PDF lezen | pdf.js (jsDelivr), eenmalig | blijven lokaal |
| Foto's (OCR) | Tesseract.js + Nederlands taalmodel (±15 MB, jsDelivr), eenmalig | blijven lokaal |
| Excel lezen | SheetJS (cdnjs), eenmalig | blijven lokaal |
| Prijsdata | `supermarkets.json` van GitHub (±10 MB) | niets verstuurd |

Na de eerste keer worden de bibliotheken gecachet (service worker), zodat de app ook offline werkt.

## Albert Heijn-gegevens

Getest op echte AH-documenten (oktober 2026, 10 kassabonnen + 2 online facturen): alle 12 sluiten tot op de cent
op het bontotaal. Geanonimiseerde versies zitten als regressietest in `tests/fixtures/`.

- **Kassabon-PDF uit de AH-app** (Profiel → Kassabonnen → bon delen/opslaan als PDF, bestandsnaam
  `AH_kassabon_…pdf`): volledig ondersteund. Herkend: aantallen, stukprijzen, `+STATIEGELD`, Bonus-artikelen
  (de `B` achter het bedrag), het kortingsblok (`BONUS …` wordt waar mogelijk aan het artikel gekoppeld),
  betalen met Miles (bonbrede korting), Koopzegels (geen boodschappen), en `31 SUBTOTAAL`.
- **Factuur van een online bestelling** (ah.nl → Mijn bestellingen → factuur-PDF): eigen parser. Leest de
  specificatie (niet de samenvatting op pagina 1), doorlopende productnamen, multipacks, statiegeld geleverd en
  retour, verpakking, koopzegels en bezorgkosten. Het vermelde "Uw voordeel" telt mee als gerealiseerde besparing.
  Let op: factuurprijzen zijn al ná bonuskorting; de normale prijs staat er niet op. Die regels tellen daarom niet
  mee voor prijsstijgingen.
- **Bekende grenzen:** AH-bonnen gebruiken afkortingen (`DZH HV MELK`, `KL KEUKEN`, `LP STOK VO`). Veel
  worden automatisch herkend en aan de volledige factuurnaam gekoppeld ("lijkt op" in het controlescherm); de rest
  corrigeert u één keer, daarna onthoudt de app het. Kortingscodes zoals `BONUS MBUITEIGENKE` zijn niet altijd
  aan een artikel te koppelen; die verschijnen als "Niet-toegewezen korting" (het totaal blijft juist).
- **AVG-inzageverzoek** bij AH: formaat niet openbaar. Is het CSV/Excel/JSON, dan leest de app het via kolomtoewijzing.
- **Bewust niet gebouwd**: inloggen op of scrapen van de AH-app of ah.nl. Er is geen officiële API voor
  klantgegevens; onofficiële koppelingen vragen om uw wachtwoord en kunnen zonder aankondiging stoppen.

## Bonus-ritme

Analyse → **Bonus** laat per product zien hoe vaak het met korting is gekocht, hoeveel korting dat gemiddeld
was, en of er een vast ritme is (bv. "ongeveer elke 6 weken in de aanbieding, volgende rond over 2 weken").
Gebruikt de B-markering op AH-bonnen, gekoppelde BONUS-regels en BONUS op online facturen.

- Op de **boodschappenlijst** staat bij een suggestie "aanbieding verwacht volgende week — wachten kan" of
  "nu in de aanbieding — overweeg 10 stuks" (verbruik per week × weken tot de volgende aanbieding).
- De **zoekfunctie** begrijpt "Wanneer is koffie weer in de aanbieding?" en "Wat komt binnenkort in de aanbieding?".
- Een ritme vraagt minstens 3 aanbiedingsperiodes met regelmatige tussenpozen; reken op 3 à 6 maanden bonnen.
- Beperking: de app ziet alleen aanbiedingen in weken dat jullie het product kochten. Het echte ritme kan vaker zijn.

Kortingen op AH-bonnen worden nu ook gekoppeld als de code niet op de naam lijkt: via een woord in de code
(`AHNEDAARDBEI` → `AARDBEI NED`), mix & match over meerdere artikelen (`MBAHVERSSAPS` → beide sappen), of als er
precies één Bonus-artikel zonder korting over is (`ALLEKNORR` → `GOODNOODLES`). Op de 12 testdocumenten: 15 van
17 kortingen gekoppeld; de 2 overige (`KELDEROPRUIM`, `MBFRUITSAL,D`) blijven bewust "niet-toegewezen".

## Inslaglijst en vriezer (Voorraad → Inslag / Vriezer)

- **Inslaglijst:** producten waarbij inslaan loont. Per item: maximale voorraad in weken, kast of vriezer,
  houdbaarheid in de vriezer, en een doelprijs. Die is automatisch het beste kwart van wat jullie betaalden
  (vanaf 4 aankopen), of een eigen bedrag.
- **Upgrade bij aanbieding:** voeg een ander merk toe als "upgrade" (bv. Starbucks naast Lidl-cups). Dat wordt alleen
  aangeraden als de actieprijs per stuk onder jullie maximum zit; zonder maximum geldt de normale prijs van het standaardproduct.
  Prijzen worden per stuk/kilo/liter vergeleken als de inhoud bekend is.
- **Aanbieding beoordelen:** vul een actie in (actieprijs, % korting, 1+1 / 2+1, 2e halve prijs, "3 voor €5"). Dan zegt de app
  inslaan of niet, hoeveel (aanvullen tot de maximale voorraad, in hele actiebundels, binnen vriezerruimte en houdbaarheid)
  en wat het scheelt. Met één tik staat het op de lijst, met winkel en actie erbij. Vanaf stap 4 gebeurt dit met de folders automatisch.
- **Voorstellen:** vaak gekochte, houdbare of invriesbare producten met een groot prijsverschil, met een geschatte besparing per maand.
- **Vriezer zonder administratie:** koopt u van een vriezerproduct meer dan normaal, dan telt het extra deel als ingevroren.
  Wat er nog ligt, volgt uit het verbruik (oudste eerst op). Correctie: **Leeg** of **+1**. Ligt iets te lang, dan staat er
  "plan in" (ook op het dashboard).
- **Mijn winkels** (Instellingen): bij welke winkels de app aanbiedingen volgt (standaard AH, Lidl, Hoogvliet, Jumbo,
  Dirk, Action, Wibra en Kruidvat). Een ritadvies met afstanden is bewust weggelaten: alle winkels liggen dichtbij.

Verbeterd in het voorraadmodel: de voorraad wordt nu opgebouwd vanaf de laatste 5 aankopen in plaats van vanaf de eerste bon.
Zo kunnen kleine afwijkingen in het tempo zich niet maandenlang opstapelen; het verbruikstempo wordt nog steeds uit de hele historie geleerd.

## Wekelijkse aanbiedingen (Prijzen → Aanbiedingen)

**Installatie op GitHub: zie LEESMIJ.md** (stap voor stap, ook voor beginners).

- `scripts/fetch-offers.mjs` (Node 20, geen afhankelijkheden) haalt de aanbiedingen op en schrijft `data/aanbiedingen.json`.
  - **Albert Heijn:** onofficiële app-API met anoniem token (`/mobile-auth/v1/auth/token/anonymous`,
    `/mobile-services/bonuspage/v3/metadata`, `/mobile-services/bonuspage/v2/section`), zoals in github.com/gwillem/appie-go.
    Alleen landelijke Bonus, geen persoonlijke Bonus Box.
  - **Lidl, Hoogvliet, Jumbo, Dirk, Action, Wibra, Kruidvat** (instelbaar met `STORES=`): winkelpagina's van Folderz.nl.
    De parser probeert ingesloten JSON en daarna HTML-blokken. Herkent hij niets, dan wordt de pagina bewaard in
    `data/debug/` om de parser te kunnen bijwerken.
  - Mislukt alles, dan blijft het vorige bestand staan en faalt de run, zodat GitHub een e-mail stuurt.
- `.github/workflows/aanbiedingen.yml` draait dagelijks om ±06:20, bij elke push en handmatig. Het publiceert de app
  op GitHub Pages; aanbiedingen en app staan dan op hetzelfde adres.
- In de app (`js/core/offers.js`):
  - actieteksten omrekenen ("1 + 1 gratis", "2e halve prijs", "4 VOOR 10.00", "55% KORTING", "voor 2.49");
  - aanbiedingen koppelen aan jullie producten (alle woorden van de basisnaam moeten erin voorkomen; het merk wordt meegewogen);
  - vergelijken met wat jullie zelf normaal betalen (schijnkortingen vallen af).

  Inslagproducten krijgen een volledig inslagadvies; vaste producten alleen als ze ≥12% goedkoper zijn dan normaal.
  Alles per winkel gegroepeerd, met één tik op de lijst.
- Privacy: de repository is openbaar, maar bevat alleen code en openbare aanbiedingen. De geanonimiseerde echte bonnen
  in `tests/fixtures/ah-*.txt` worden niet meegeleverd (`.gitignore`); de tests die ze gebruiken slaan zichzelf dan over.

## Prijsgegevens

Er zijn geen officiële, openbare prijs-API's van AH, Jumbo, Lidl, Aldi, Dirk of PLUS. De app gebruikt de
open data van [Checkjebon.nl](https://github.com/supermarkt/checkjebon), een vrijwilligersproject dat
dagelijks de online prijzen van ±12 supermarkten verzamelt.

- Geen aanbiedingen/bonusprijzen in deze bron. Aldi heeft er geen prijzen in; Lidl komt via boodschaapje.nl.
- De app toont altijd de datum van de bron en het ophaalmoment, en waarschuwt bij verouderde data.
- Alleen (vrijwel) exacte naammatches tellen automatisch mee. Twijfelgevallen staan als "onzeker" in de
  tabel en kunt u eenmalig vastzetten. Het **eerlijke vergelijkingstotaal** telt alleen producten die in
  alle gekozen winkels gevonden zijn.
- Een andere bron koppelen: lever items in het formaat van `parseCheckjebon()` in `js/core/prices.js`.

## Architectuur

```
index.html, css/app.css, sw.js, manifest.webmanifest
js/core/        pure rekenlogica (getest, zonder browser-afhankelijkheden)
  money, dates, text, stores, categories   basis (bedragen in hele centen)
  receipt-parser   bontekst → regels, kortingkoppeling, totaalcontrole
  table-import     CSV/Excel/JSON → bonnen via kolomtoewijzing
  products         normalisatie, merken, inhoud, basisproduct-sleutel, matching
  commit, dedupe   bonvoorstel → opslagrecords, dubbele-importdetectie
  analytics        uitgaven-"feiten" (netto na gekoppelde korting), dashboard, prijsstijgingen
  stock-model      voorraadvoorspelling
  savings          besparingsadviseur
  query            Nederlandse vragen → berekening
  prices           prijsbron, matching, mandvergelijking (1 of 2 winkels)
  backup, demo
js/data/        IndexedDB-laag en applicatiestatus (alle schrijfacties atomair)
js/import/      PDF/OCR/Excel-extractie (bibliotheken lazy geladen)
js/ui/          schermen, grafieken (SVG), componenten
```

**Rekenregels.** Boodschappenuitgaven = artikelen + retouren + kortingen; statiegeld en koopzegels tellen
niet mee. Een korting die aan een artikel gekoppeld is, telt bij dat product; een korting die niet te koppelen
is, verschijnt als aparte post "Niet-toegewezen korting". Zo telt elke cent precies één keer.

**Demomodus** (Instellingen) gebruikt een aparte database met fictieve bonnen en een duidelijke banner.

## Bekende beperkingen

- OCR op gekreukte of slecht belichte foto's is foutgevoelig; het controlescherm vangt dit op, maar het kost
  dan handwerk. Schermafbeeldingen van digitale bonnen en tekst-PDF's zijn veel betrouwbaarder.
- De bonparser is getest op gangbare bonvormen, niet op echte bonnen van elke keten. Ziet u een bon die
  structureel misgaat, dan is de oplossing een extra patroon in `receipt-parser.js` (plus een test).
- HEIC-foto's werken alleen in browsers die HEIC kunnen tonen (Safari wel, Chrome op Windows niet).
- Productmatching voor prijsvergelijking is op naam; controleer de per-producttabel.
