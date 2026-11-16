# Edward

Assistente personale AI pensato per girare in locale su un Raspberry Pi 4.

- **Giornale del mattino**: ogni notte un job raccoglie le notizie dalle tue fonti RSS e Claude le riorganizza in un giornale per sezioni, con un testo pronto da leggere ad alta voce.
- **Meteo**: temperature di mattina, pomeriggio e sera (reale e **percepita**) con consigli su come vestirti. Usa Open-Meteo, gratuito e senza chiave.
- **Calendario**: vista mese, settimana e lista. Puoi creare impegni cliccando o selezionando, spostarli e ridimensionarli trascinandoli, modificarli ed eliminarli.
- **Voce**: Edward è sempre in ascolto ma si attiva solo dopo **"Edward per favore"**. Puoi chiedergli di leggerti il giornale, il meteo o l'agenda, di aggiungere, spostare o cancellare impegni, di cercare su internet e di cambiare fonti o località.

## Struttura

```
edward/
├── backend/                 Node.js + Express (API, job notturno, AI)
│   └── src/
│       ├── index.js         server HTTP/HTTPS, serve anche il frontend compilato
│       ├── db.js            SQLite (node:sqlite, nessuna compilazione nativa)
│       ├── jobs/nightly.js  cron notturno
│       ├── routes/api.js    API REST
│       └── services/
│           ├── briefing.js  pipeline: notizie → meteo → agenda → giornale (Claude)
│           ├── assistant.js Edward conversazionale con strumenti + ricerca web
│           ├── calendar.js  impegni
│           ├── weather.js   Open-Meteo + consigli vestiti
│           ├── news.js      lettura feed RSS
│           └── speech.js    voce lato server (whisper.cpp / Piper, opzionale)
├── frontend/                React + Vite
│   └── src/
│       ├── pages/           Oggi (giornale), Calendario, Impostazioni
│       ├── components/      barra vocale, finestra impegni
│       ├── hooks/useEdward.js  ascolto, parola di attivazione, comandi
│       └── lib/             API, sintesi vocale, motori di riconoscimento
└── deploy/edward.service    avvio automatico con systemd
```

## Installazione sul Raspberry Pi 4 (Docker, un comando)

Ti servono **Raspberry Pi OS a 64 bit** e Docker. Edward e SearXNG partono insieme e ripartono da soli a ogni accensione.

```bash
# 1. nome in rete: il Pi diventa raggiungibile come edward.local (una volta sola)
sudo hostnamectl set-hostname edward
sudo sed -i 's/127.0.1.1.*/127.0.1.1\tedward/' /etc/hosts   # l'avviso "unable to resolve host" qui è normale
sudo reboot

# 2. Docker (una volta sola)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER          # poi esci e rientra

# 3. progetto e chiavi (senza sudo, così i file restano del tuo utente)
git clone <url-repo> ~/edward && cd ~/edward
cp .env.example .env && nano .env      # oppure dal Mac: scp .env <utente>@edward.local:~/edward/.env

# 4. via
docker compose up -d
```

`.local` è il suffisso che i dispositivi di casa risolvono da soli (mDNS), senza configurare un DNS: funziona su Mac, iPhone, Windows e Linux; su alcuni Android serve l'IP.

Apri **https://edward.local** e accetta l'avviso sul certificato (è self-signed, creato al primo avvio).

| Cosa | Comando rapido | Equivalente Docker |
|---|---|---|
| Avviare / ricostruire | `npm run up` | `docker compose up -d --build` |
| Riavviare rileggendo il `.env` | `npm run restart` | `docker compose up -d --force-recreate edward` |
| Log in tempo reale (Ctrl+C per uscire) | `npm run logs` | `docker compose logs -f --tail=100 edward` |
| Spegnere tutto | `npm run down` | `docker compose down` |
| Aggiornare | `git pull && npm run up` | |

I comandi rapidi richiedono npm sul Pi (`sudo apt install -y npm`). Altrimenti usa gli equivalenti Docker.

| Altro | Comando |
|---|---|
| Generare il giornale adesso | `npm run news`, oppure `docker compose exec edward node backend/src/scripts/run-nightly.js` |
| Backup dei dati | `docker run --rm -v edward_edward-data:/d -v $PWD:/b alpine tar czf /b/edward-data.tgz -C /d .` |

Cosa fa da solo `docker compose up -d`:

- Costruisce Edward: backend più pagina web compilata.
- Avvia **SearXNG** e genera la sua chiave segreta. SearXNG è raggiungibile solo da Edward e dal Pi stesso (`127.0.0.1:8888`).
- Crea un **certificato HTTPS**, necessario per usare il microfono da telefono o PC. Se raggiungi il Pi con un altro nome o un IP fisso, aggiungili al `.env`, per esempio `CERT_HOSTS=edward.local,192.168.1.50`. Il certificato copre anche l'host di `PUBLIC_URL` e si rigenera da solo quando aggiungi nomi nuovi; in alternativa usa `HTTPS_CERT`/`HTTPS_KEY` tuoi. Se apri `http://` vieni rimandato automaticamente a `https://`.
- Conserva calendario, giornali e token Netatmo nel volume `edward-data`, che sopravvive ad aggiornamenti e riavvii.

Il job notturno gira dentro il server (node-cron), quindi non serve configurare crontab. L'orario si imposta in `.env` con `NIGHTLY_CRON`; il default è `30 5 * * *`, cioè le 05:30.

Con Docker Edward risponde sulle porte standard: **443** (https) e **80** (rimanda a https), quindi l'indirizzo non ha bisogno di `:porta`. Se quelle porte sono già occupate metti per esempio `EDWARD_PORT=8443` e `EDWARD_HTTP_PORT=8080` nel `.env`, e aggiungi la porta a `PUBLIC_URL`.

### Senza Docker

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs ffmpeg openssl
npm install && npm run build
npm start                     # HTTPS=auto nel .env per il certificato automatico
```

In questo caso SearXNG va avviato a parte. Per l'avvio automatico usa `deploy/edward.service`:

```bash
sed "s/^User=.*/User=$USER/; s#^WorkingDirectory=.*#WorkingDirectory=$PWD#" deploy/edward.service | sudo tee /etc/systemd/system/edward.service
sudo systemctl daemon-reload && sudo systemctl enable --now edward
```

## Microfono e HTTPS

Il browser concede il microfono solo su **https://** oppure su **localhost**.

- Se usi Edward **sul Raspberry stesso** (http://localhost:3000) funziona subito.
- Se lo apri **da telefono o PC** sulla rete di casa serve HTTPS. Con `HTTPS=auto` (il default con Docker) Edward crea da solo un certificato al primo avvio. Senza Docker puoi anche generarlo con `npm run certs --workspace backend` e copiare le righe stampate nel `.env`.

  Al primo accesso a `https://<ip>` il browser mostrerà un avviso sul certificato self-signed: accettalo.

## Voce: due modalità

| | Riconoscimento | Sintesi |
|---|---|---|
| **Browser** (default) | Web Speech API: Chrome/Edge su PC e Android. Veloce, ma usa i server di Google | voce italiana del browser |
| **Server** (opzionale) | whisper.cpp sul Raspberry | Piper sul Raspberry |

**Chromium sul Raspberry non ha il riconoscimento vocale del browser.** Se vuoi parlare con Edward usando un microfono USB collegato al Pi, configura whisper.cpp; per una voce migliore aggiungi anche Piper.

```bash
# whisper.cpp
git clone https://github.com/ggml-org/whisper.cpp ~/whisper.cpp && cd ~/whisper.cpp
cmake -B build && cmake --build build -j4 --config Release
./models/download-ggml-model.sh base      # "tiny" = più veloce, "small" = più preciso
# nel .env:
# WHISPER_CPP_BIN=/home/pi/whisper.cpp/build/bin/whisper-cli
# WHISPER_MODEL=/home/pi/whisper.cpp/models/ggml-base.bin

# Piper (voce italiana)
# scarica il binario arm64 da https://github.com/rhasspy/piper/releases
# e una voce it_IT (es. it_IT-paola-medium.onnx + .json)
# PIPER_BIN=/home/pi/piper/piper
# PIPER_MODEL=/home/pi/piper/it_IT-paola-medium.onnx
```

⚠ whisper.cpp e Piper non sono inclusi nell'immagine Docker. La modalità server richiede l'installazione senza Docker. Se usi Edward da telefono o PC con Chrome non ti servono.

In modalità server il browser registra solo quando rileva voce e invia lo spezzone al Pi per la trascrizione. Con il modello `base` ogni frase richiede qualche secondo su un Pi 4.

## Come si usa a voce

1. Premi il cerchio in basso per attivare il microfono. Il browser chiede il permesso solo la prima volta.
2. Di' **"Edward per favore"**: senti un bip e il cerchio diventa dorato. Poi dai il comando. Puoi anche dire tutto in una frase: *"Edward per favore, che tempo fa domani?"*.
3. Dopo la risposta Edward resta in ascolto per qualche secondo, così puoi fare un'altra domanda senza ripetere la frase di attivazione. Per chiudere di' "grazie" o "basta".

Esempi:

- "leggimi il giornale"
- "come mi vesto oggi?"
- "cosa ho in programma questa settimana?"
- "aggiungi cena da Marco venerdì alle otto e mezza"
- "sposta il dentista a giovedì alle 17"
- "cancella la riunione di domani"
- "chi ha vinto ieri sera?" (cerca su internet)
- "aggiungi Il Fatto Quotidiano alle fonti delle notizie"

Puoi anche scrivere nella casella di testo della barra in basso.

## AI e costi

- **Claude Haiku 5.5** (`EDWARD_MODEL`) gestisce voce, calendario, termostato e ricerche, con un livello di ragionamento basso (`effort: low`).
- **DeepSeek V4.1 Flash** scrive il giornale notturno (`DEEPSEEK_API_KEY`). Senza quella chiave il giornale lo scrive Haiku.
- La ricerca web passa da SearXNG, gratis, con Gemini come riserva.
- Stima con circa 15-30 domande al giorno: **1-2 $ al mese** in tutto.

Senza chiavi API Edward funziona comunque: giornale in versione semplice, meteo e agenda con le risposte istantanee, calendario. Le domande libere richiedono la chiave Anthropic.

## Chi fa cosa

| Compito | Modello / servizio | Dati che vede |
|---|---|---|
| Testo del giornale notturno, consigli meteo | **DeepSeek V4.1 Flash** | solo notizie pubbliche e meteo |
| Voce, calendario, termostato, domande, ricerche web | **Claude Haiku 5.5** | tutto |
| Meteo, agenda, temperatura di casa, "leggimi il giornale" | nessun modello (risposte istantanee) | — |
| Ricerca web | **SearXNG** locale, con **Gemini + Google Search** di riserva | le query di ricerca |

## Ricerca web (SearXNG + Gemini)

Edward cerca sul web con **SearXNG**, un metamotore open source che gira sul Raspberry: interroga Google, Bing, DuckDuckGo e altri, e non costa nulla. Le pagine le scarica e le legge Edward stesso, quindi anche la lettura è gratuita. Se SearXNG non risponde, la ricerca passa a **Gemini con Google Search**, che ha 5000 ricerche al mese incluse.

Con Docker, SearXNG parte da solo insieme a Edward (vedi Installazione). Verifica:

```bash
curl "http://localhost:8888/search?q=viareggio&format=json" | head -c 300
```

Per la riserva Gemini, aggiungi `GEMINI_API_KEY` (da https://aistudio.google.com) al `.env`. La ricerca Google è disponibile solo sul piano a pagamento, quindi devi attivare la fatturazione sul progetto. Finché resti sotto le 5000 ricerche al mese, la ricerca non costa nulla; paghi solo pochi centesimi per i token del modello.

Per evitare spese impreviste ci sono tre protezioni: al massimo 4 ricerche o pagine lette per domanda (`MAX_SEARCHES_PER_QUESTION`), una memoria di un'ora per le ricerche ripetute, e un contatore mensile in Impostazioni. Edward rifiuta di leggere indirizzi della rete di casa, e tratta il contenuto delle pagine web come testo da leggere, mai come comandi.

## Termostato BTicino Smarther2 (Home + Control)

Lo **Smarther2** usato con l'app Home + Control si comanda tramite l'API Netatmo Connect (permessi `read_smarther` e `write_smarther`). È lo stesso metodo usato con successo dal progetto open source smarther2mqtt. Le modalità disponibili sono manuale, programma, boost e antigelo; "spegnere" corrisponde all'antigelo.

1. Vai su https://dev.netatmo.com/apps, accedi con l'account che usi in Home + Control e crea un'app.
2. Copia *client ID* e *client secret* nel `.env` (`NETATMO_CLIENT_ID`, `NETATMO_CLIENT_SECRET`).
3. Poi scegli **uno** di questi due modi:
   - **Token generator (consigliato).** Nella pagina dell'app su dev.netatmo.com seleziona gli scope `read_smarther` e `write_smarther`, genera il token e copia il *refresh token* in `NETATMO_REFRESH_TOKEN`. Riavvia Edward. Il token serve solo al primo avvio: poi Edward lo rinnova da solo e lo conserva nel database.
     - L'access token non serve: basta il refresh token.
     - Ogni volta che rigeneri il token, Netatmo **revoca quello precedente**. Generalo una volta sola e copialo subito.
     - Al primo uso Netatmo sostituisce il token con uno nuovo, che resta nel database di *quel* computer. Se lo provi sul Mac e poi sposti Edward sul Raspberry, copia anche `backend/data/edward.db`, oppure genera un token nuovo e mettilo nel `.env` del Pi. Edward riconosce il token nuovo e lo usa al posto del vecchio.
   - **Login dal sito.** Nell'app Netatmo imposta come *redirect URI* `PUBLIC_URL` + `/api/thermostat/callback`, per esempio `https://edward.local/api/thermostat/callback`. Poi in Impostazioni → Termostato premi **Collega il termostato**.

A voce puoi chiedere: *"che temperatura c'è in casa?"* (risposta istantanea), *"alza il riscaldamento a 21 gradi per due ore"*, *"rimetti il termostato sul programma"*, *"spegni il riscaldamento, parto per il weekend"* (antigelo), *"fai un boost di mezz'ora"*.

## Approfondimenti: articoli letti per intero

Per le sezioni "approfondite" (mercati, geopolitica, tecnologia) il job notturno non si ferma alle 2-3 righe dei feed:

1. l'AI sceglie le notizie più importanti, scartando curiosità, gallerie e guide all'acquisto;
2. Edward legge l'articolo intero, dal feed se lo contiene (es. Formiche) oppure scaricando la pagina;
3. il giornale scrive riassunto e contesto a partire dal testo completo. Nella pagina queste notizie sono segnate con 📖.

Il numero di articoli si regola con `BRIEFING_DEEP_READS` (default 8). Gli articoli a pagamento, per esempio parte del Sole 24 Ore, vengono saltati e restano con l'anteprima del feed. Il log notturno in Impostazioni dice quali articoli sono stati letti e quali no.

## Giornale con DeepSeek

Il giornale notturno contiene solo notizie pubbliche e meteo, e si può far scrivere a **DeepSeek V4.1 Flash**, che costa molto meno. Basta aggiungere `DEEPSEEK_API_KEY` al `.env`.

Per privacy, a DeepSeek **non viene mai inviato il calendario**: gli impegni vengono inseriti in locale nel testo da leggere ad alta voce. Il log di ogni esecuzione notturna, visibile in Impostazioni → Sistema, riporta i token consumati.

## Risposte istantanee

"Che tempo fa", "come mi vesto domani", "cosa ho in programma oggi" e "leggimi il giornale" ricevono risposta in locale, senza AI: immediata, gratuita, e disponibile anche senza chiave. Tutto il resto, comprese le richieste ambigue, va al modello AI.

## Sviluppo

```bash
npm run dev     # backend su :3000 (watch) + Vite su :5173 con proxy /api
```
