# Boodschappenbrein op GitHub zetten

Met deze stappen gebeuren er twee dingen tegelijk:

1. **De app krijgt een eigen webadres** (`https://JOUWNAAM.github.io/boodschappenbrein/`), dat je op je iPhone en
   computer opent en op het beginscherm zet. Geen computer meer nodig die aan moet staan.
2. **Elke ochtend worden de aanbiedingen opgehaald** (AH, Lidl, Hoogvliet, Jumbo, Dirk, Action, Wibra en Kruidvat) en in
   de app getoond onder **Prijzen → Aanbiedingen**.

Alles is gratis. Reken op ±15 minuten.

> **Privacy.** De repository (de map op GitHub) is openbaar: dat is nodig voor gratis GitHub Pages. Er staat
> alleen programmacode en openbare folderinformatie in. **Jullie bonnen en aankopen staan er niet in.** Die blijven in de
> browser op jullie eigen telefoon/computer.

---

## Route A: Claude doet het (makkelijkst)

1. Ga op claude.ai naar **Instellingen → Connectors** en koppel **GitHub**. Geef toegang tot (minimaal) de nieuwe repository.
2. Maak op github.com een lege repository aan, zie stap 1 van route B (alleen stap 1).
3. Laat in de chat weten hoe hij heet (bijvoorbeeld `jouwnaam/boodschappenbrein`). Claude zet dan de bestanden erin, zet
   GitHub Pages aan, start de eerste ophaalactie en kijkt in de logboeken of alle winkels goed binnenkomen.

## Route B: zelf via de website

### Stap 1: Een lege repository maken
1. Ga naar **github.com** en log in.
2. Klik rechtsboven op het **+** en kies **New repository**.
3. Vul in:
   - **Repository name:** `boodschappenbrein`
   - Kies **Public**.
   - Vink **niets** aan (geen README, geen .gitignore, geen licentie).
4. Klik op **Create repository**.

### Stap 2: De bestanden uploaden
1. Pak `boodschappenbrein.zip` uit op je computer.
2. Klik op de lege repositorypagina op de link **uploading an existing file**.
3. Open de uitgepakte map `boodschappenbrein` en selecteer **alles wat erin staat** (niet de map zelf). Sleep dat
   naar het uploadvak in de browser.
   - **Mac:** de map `.github` is standaard onzichtbaar. Druk in Finder op **Cmd + Shift + .** (punt) om hem te zien,
     en sleep hem mee.
   - **Windows:** `.github` is gewoon zichtbaar.
4. Wacht tot alle bestanden in de lijst staan en klik onderaan op **Commit changes**.
5. Controleer: in de repository moet nu een map **.github** staan. Staat die er niet, zie *Problemen* onderaan.

### Stap 3: GitHub Pages aanzetten
1. Klik in de repository bovenaan op **Settings** (tandwiel).
2. Kies links **Pages**.
3. Zet onder **Build and deployment → Source** de keuze op **GitHub Actions**.
   (Je hoeft verder niets te kiezen.)

### Stap 4: De eerste keer starten
1. Klik bovenaan op **Actions**.
   - Zie je de knop **I understand my workflows, go ahead and enable them**? Klik erop.
   - Staat er al een rode run van daarnet? Geen probleem: die liep voordat Pages aanstond.
2. Klik links op **Aanbiedingen en app**.
3. Klik rechts op **Run workflow** en dan op de groene knop **Run workflow**.
4. Wacht 2 à 3 minuten. Een **groen vinkje** betekent dat het gelukt is.
5. Klik op de run en daarna op **bijwerken → Aanbiedingen ophalen** om per winkel te zien hoeveel aanbiedingen er
   binnenkwamen. Staat er bij een winkel `NEE` of `0`, stuur dan het logboek naar Claude: met de opgeslagen pagina in
   `data/debug/` is het snel te repareren.

### Stap 5: De app openen
1. Ga naar **Settings → Pages**. Bovenaan staat: *Your site is live at* `https://JOUWNAAM.github.io/boodschappenbrein/`.
2. Open dat adres op je **iPhone in Safari** en tik op **Deel → Zet op beginscherm**.
3. Doe hetzelfde op de telefoon van je partner, als die de lijst ook gebruikt.

### Stap 6: Je gegevens overzetten
Gegevens zijn per webadres opgeslagen. Gebruikte je de app al op een ander adres (bv. `localhost`)?
1. Open de oude app → **Instellingen → Back-up downloaden**.
2. Open de nieuwe app (GitHub-adres) → **Instellingen → Back-up terugzetten** en kies het bestand.
Je kunt ook gewoon opnieuw je bonnen importeren: dubbele bonnen worden herkend.

---

## Hoe het daarna werkt
- Elke ochtend rond 06:20 haalt GitHub de aanbiedingen op en zet ze in `data/aanbiedingen.json`.
- De app haalt dat bestand op als je hem opent (en het ouder is dan 6 uur), of als je op **Vernieuwen** tikt.
- Mislukt het ophalen helemaal, dan krijg je een e-mail van GitHub ("Run failed"). De app blijft werken met de vorige
  aanbiedingen en toont per winkel wat wel en niet lukte.
- Een nieuwe versie van de app? Upload de gewijzigde bestanden op dezelfde manier (stap 2). GitHub publiceert dan vanzelf opnieuw.

## Problemen
- **De map `.github` ontbreekt na uploaden.** Klik in de repository op **Add file → Create new file**. Typ als naam:
  `.github/workflows/aanbiedingen.yml` (de schuine strepen maken vanzelf mappen). Plak de inhoud van dat bestand uit de
  uitgepakte zip, en klik **Commit changes**.
- **Rode run bij "deploy".** Controleer stap 3 (Pages → Source → GitHub Actions) en start de run opnieuw.
- **De app toont "bestand niet gevonden".** De eerste run is nog niet klaar of is mislukt; zie stap 4.
- **Een winkel geeft steeds 0.** Waarschijnlijk is de pagina van Folderz veranderd. Start de run met
  **Run workflow** (het vinkje *Folderz-pagina's bewaren* staat standaard aan) en stuur Claude het bestand
  `data/debug/WINKEL.html` of het logboek.
