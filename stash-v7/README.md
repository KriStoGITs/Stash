# STASH noliktavas vadības sistēma

Uzņēmuma iekšējā tīmekļa lietotne latviešu valodā. Node.js serveris, SQLite datubāze un serverī ģenerētas HTML formas. Ārējas bibliotēkas nav nepieciešamas. Navigācija veidota pēc pievienotajiem zilās sānjoslas piemēriem un papildināta ar uzdevumā prasītajām funkcijām.

## Palaišana

Nepieciešams **Node.js 24 vai jaunāks** ar iebūvēto `node:sqlite`. Versiju pārbauda ar `node --version`.

1. Atarhivējiet projekta ZIP un atveriet termināli projekta mapē.
2. Pirmajā reizē izpildiet `node setup.js`.
3. Terminālī tiks parādīti trīs konti un katram nejauši ģenerēta parole. Saglabājiet tās drošā vietā. Atkārtota inicializācija esošos kontus nepārraksta.
4. Izpildiet `node server.js` (vai `npm start`, vai Windows failu `Sakt.cmd`).
5. Pārlūkā atveriet `http://127.0.0.1:3000`.

Konti: `admin@stash.lv`, `worker@stash.lv`, `sorter@stash.lv`. Kopīga noklusējuma parole nav iestatīta. Administratoram ir iespēja nomainīt jebkura lietotāja paroli sadaļā “Lietotāji”. `npm install` nav nepieciešams.

Serveri aptur ar Ctrl+C. Nākamajās palaišanās `setup.js` vairs nav jāizpilda. Datubāze automātiski tiek saglabāta `data/stash.sqlite`.

## Lomas

| Darbība | Administrators | Darbinieks | Plauktu kārtotājs |
| --- | --- | --- | --- |
| Apskatīt, meklēt preces | Jā | Jā | Jā |
| Izveidot, rediģēt preces un pieejamo atlikumu | Jā | Jā | Nē |
| Dzēst preces | Jā | Nē | Nē |
| Izveidot pasūtījumus, mainīt to statusu | Nē | Jā | Nē |
| Reģistrēt vietu un stāvokli | Jā | Nē | Jā |
| Pārvaldīt lietotājus un lomas | Jā | Nē | Nē |
| Preču un izvietojuma atskaites | Jā | Jā | Jā |
| Pasūtījumu atskaites | Jā | Jā | Nē |
| Izvietojuma izmaiņu vēsture | Jā | Jā | Jā |
| Pilna darbību vēsture | Jā | Jā | Nē |

Sadaļās “Izvietot preces” un “Datu ievade” kārtotājs izmanto vienu izvietojuma reģistrēšanas formu. Izmaiņas saglabā auditā. Lomas attiecas uz visu attiecīgās sadaļas informāciju; noliktava ir kopīga visiem darbiniekiem.

## Pasūtījumu darbība

Pasūtījumā iespējams izvēlēties vairākas preces. Izveidojot jaunu pasūtījumu, pieejamais atlikums samazinās par rezervēto daudzumu. Ja kaut vienai precei nepietiek atlikuma, visa transakcija tiek atcelta.

Atļautās pārejas: `Jauns → Apstrādē → Izpildīts`, `Jauns → Atcelts`, `Apstrādē → Atcelts`. Atcelšana atgriež krājumu tikai vienreiz. Pabeigts vai atcelts pasūtījums vairs nav maināms. Preci, kas izmantota pasūtījumā, nevar izdzēst, lai saglabātu pasūtījuma vēsturi.

Preces daudzuma manuāla rediģēšana ir **pieejamā atlikuma korekcija**. Rezervētās vienības ir pasūtījumos. Piemēram, pēc 10 vienību atlikuma un pasūtījuma par 3 vienībām pieejamais atlikums ir 7. Atceļot pasūtījumu, atkal ir 10.

Atskaitēs pieejama priekšskatīšana un CSV lejupielāde ar UTF-8 BOM un semikolu atdalītāju, ko var atvērt Excel. Datubāzes datumi ir UTC; atskaites sagatavošanas laiks tiek parādīts Rīgas laika joslā.

## Validācija un drošība

- Visām datu izmaiņām serveris pārbauda sesiju, lomu un CSRF tokenu. Izrakstīšanās ir POST darbība.
- Paroles glabājas kā `scrypt` jaucējvērtības ar nejaušu sāli. Jauniem kontiem vajag 12–128 rakstzīmju paroli ar lielo burtu, mazo burtu un ciparu.
- Sesijas glabājas SQLite, beidzas pēc 8 stundām un izmanto nejaušu 256 bitu identifikatoru ar `HttpOnly` un `SameSite=Strict` sīkdatni.
- Lomas vai paroles maiņa anulē visas attiecīgā konta sesijas. Savu administratora kontu nevar dzēst vai pazemināt. Pēdējais administrators tiek saglabāts.
- Pēc 5 kļūdainiem pieslēgšanās mēģinājumiem no vienas IP adreses ir 15 minūšu ierobežojums. Lietotāji aiz vienas IP adreses dala šo ierobežojumu.
- SQL parametri ir saistīti sagatavotos vaicājumos; HTML izvade tiek ekranēta. CSP ierobežo skriptus un iframe. CSV tekstam pievienota aizsardzība pret formulām.
- Serveris pārbauda laukus, lomas, statusus, unikālus preču kodus un e-pastus, veselus nenegatīvus daudzumus, eksistējošus ierakstus. Pārlūka validācija ir papildinājums servera pārbaudēm.
- SQLite ārējās atslēgas un transakcijas aizsargā saistītos datus un krājumu izmaiņas. Paroles un datubāze netiek iekļautas Git vai ZIP arhīvos.

## Pārbaude

Izpildiet `npm test` vai `node --test tests/app.test.js`. Testi izveido atsevišķu pagaidu datubāzi, pieslēdzas ar katru lomu, pārbauda aizliegtus pieprasījumus, CSRF, ievades kļūdas, HTML ekranēšanu, CSV aizsardzību, pasūtījumu rezervāciju, atcelšanu, paralēlus pasūtījumus, transakciju atcelšanu un sesiju atsaukšanu. Testi neizmanto jūsu darba datubāzi.

Manuāls izmēģinājums:

1. Administrators pievieno preci ar atlikumu 10 un izveido jaunu lietotāju.
2. Darbinieks izveido pasūtījumu par 3 vienībām: atlikums kļūst 7. Maina statusu uz “Apstrādē”, pēc tam “Atcelts”: atlikums atkal ir 10.
3. Kārtotājs saglabā vietu `A-01-02` un stāvokli “Jāpārbauda”; atver izvietojuma atskaiti un lejupielādē CSV.
4. Kārtotājs ievada adresi `/users`: serveris atgriež 403. Darbinieks nedrīkst izdzēst preci vai izveidot lietotāju.

## Konfigurācija un ekspluatācija

Pēc noklusējuma serveris pieejams tikai lokālajā datorā. Vides mainīgie: `PORT` (3000), `HOST` (127.0.0.1), `DATA_DIR` (projekta `data` mape), `COOKIE_SECURE` (1 HTTPS izmantošanai). Iekšējā serverī izmantojiet HTTPS reverso starpniekserveri, `COOKIE_SECURE=1` un ierobežotas operētājsistēmas tiesības uz datu mapi. HOST mainiet tikai tad, kad ir konfigurēta paredzētā tīkla piekļuve. Šis projekts pats nepiegādā TLS sertifikātu vai rezerves kopiju servisu.

Rezerves kopijai apturiet serveri un nokopējiet visu `data` mapi drošā vietā. Datu atjaunošanai apturiet serveri un ievietojiet iepriekš saglabāto mapi. Lai pilnībā sāktu no jauna, pārvietojiet esošo `data` mapi citur un vēlreiz palaidiet inicializāciju. Tas nav nepieciešams ikdienas darbā.

## Failu uzbūve

- `server.js` — HTTP serveris, sesiju pārbaude un maršrutēšana.
- `core.js` — kopīgo funkciju eksports; esošie moduļu importi ir saglabāti.
- `lib/database.js` — SQLite shēma, indeksi, transakcijas un audits.
- `lib/validation.js` — lauku, skaitļu un piekļuves tiesību pārbaude.
- `lib/passwords.js` — paroļu jaukšana un pārbaude.
- `lib/http.js` — sīkdatnes un ierobežota apjoma UTF-8 formu lasīšana.
- `lib/auth.js` — pieslēgšanās, mēģinājumu ierobežojums un sesiju izveide.
- `lib/views.js` — HTML palīgfunkcijas, lapas izkārtojums un navigācija.
- `modules/` — sākums, preces, lietotāji, pasūtījumi, izvietojums un atskaites.
- `setup.js` — sākotnējo kontu izveide.
- `public/style.css` — saskarnes stili.
- `tests/` — integrācijas un regresiju testi.

Formatēšanas noteikumi ir `.editorconfig` un `.prettierrc.json`. Darbībai joprojām nav vajadzīgas ārējas bibliotēkas. Izstrādes laikā kodu var formatēt ar `npx prettier@3.6.2 --write .` (šai komandai nepieciešams internets).

## Koda pārbaude un uzlabojumi

Kods sadalīts pēc atbildības, izlīdzināts formatējums un pievienoti regresiju testi. Saglabāta esošā datubāzes shēma; jauni indeksi tiek pievienoti automātiski, un dati nav jāinicializē atkārtoti.

Novērsta UTF-8 simbolu bojāšana sadalītos HTTP pieprasījumos, sesijas tiesību saglabāšanās lēna pieprasījuma laikā pēc sesijas atsaukšanas, bojātu paroļu jaucējvērtību izraisītas servera kļūdas un pasūtījumu skaita rādīšana kārtotājam. Atkārtota pieslēgšanās aizstāj iepriekšējo pārlūka sesiju. Atskaites ielādē tikai izvēlētās sadaļas datus; pasūtījumu saraksts preču detaļas iegūst vienā vaicājumā.

Automatizēta pārbaude neapliecina pilnu produkcijas drošību vai darbību lielā datu apjomā. Lielām noliktavām sarakstiem vēl nepieciešama lapošana, bet HTTPS un rezerves kopijas jākonfigurē atbilstoši ekspluatācijas sadaļai.

## Versiju kontrole

Pievienotajā Git bundle ir septiņi komiti un tagi `v1`–`v7`. Lai atjaunotu repozitoriju, izpildiet `git clone STASH-history.bundle stash`, pēc tam `git -C stash log --oneline --decorate`. Konkrētu posmu atver ar `git -C stash switch --detach v3`.

Visi septiņi posmi izveidoti vienā faktiskā darba sesijā. Komitu datumi nav pārrakstīti, un tie neapliecina darbu septiņās mācību dienās. Turpmākajās nodarbībās komitus veidojiet pēc reāli paveiktajām izmaiņām ar `git add .` un `git commit -m "Apraksts"`. GitHub attālinātais repozitorijs nav izveidots.
