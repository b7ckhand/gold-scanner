# Gold scanner and Telegram Mini App

A free XAUUSD scanner that runs on GitHub every 5 minutes, messages you on Telegram when a new A or B setup appears, and opens as an app inside your bot.

It uses the same six strategies, backtests and A, B, C grading as the Claude dashboard.

## What you need (all free)

1. A GitHub account.
2. A Telegram account.
3. A Twelve Data account with a free API key.

## Step 1. Create your Telegram bot

1. In Telegram, search for **BotFather** and open the chat with the blue tick.
2. Send `/newbot`, then choose a name and a username ending in `bot`.
3. BotFather replies with a **token**. Copy it. Keep it private.
4. Open your new bot and press **Start**, then send it any message such as `hi`.
5. In a browser, open `https://api.telegram.org/botYOURTOKEN/getUpdates` (replace YOURTOKEN, keep the word `bot` in front of it).
6. Find `"chat":{"id":` followed by a number. That number is your **chat id**. Copy it.

## Step 2. Get a Twelve Data key

Sign up at twelvedata.com, open your dashboard and copy the **API key**.

## Step 3. Create the GitHub repository

1. On GitHub choose **New repository**. Name it, for example, `gold-scanner`. Set it to **Public** (public repositories get unlimited free Actions minutes).
2. Unzip this package. On the repository page choose **Add file, Upload files** and drag in everything from the unzipped folder, then commit.
3. Your computer may hide the `.github` folder, so check that `.github/workflows/scan.yml` appears in the repository. If it does not, choose **Add file, Create new file**, type `.github/workflows/scan.yml` as the name, paste in the contents of `scan-workflow.yml`, and commit.

## Step 4. Add three secrets

Repository **Settings, Secrets and variables, Actions, New repository secret**. Add these names exactly:

| Name | Value |
| --- | --- |
| TWELVEDATAKEY | Your Twelve Data key |
| TELEGRAMTOKEN | The token from BotFather |
| TELEGRAMCHATID | Your chat id |

## Step 5. Turn on the Mini App page

**Settings, Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch **main**, folder **/docs**, and Save. After a minute the page address appears: `https://YOURUSERNAME.github.io/gold-scanner/`.

## Step 6. Start the scanner

1. Open the **Actions** tab. If GitHub asks, enable workflows.
2. Choose **scan**, then **Run workflow**.
3. Within a minute or two your bot sends **Gold scanner connected**. The first run also sets the bot's menu button, so tap the button beside the message box to open **Gold desk**.

After that the scanner runs by itself every 5 minutes.

## How it behaves

- **Alerts:** one message for each new A or B setup, with an Open desk button. Setups already on the board when you first connect are not announced. If the same strategy repeats on the next candles, only the first is sent.
- **Market closed:** at weekends and the daily break there are no alerts, and the scanner refreshes only every 15 minutes.
- **Twelve Data requests:** about 420 a day while the market is open. The free plan allows 800 a day, shared with anything else using your account, such as the Claude dashboard. If you leave the dashboard open, set its refresh to 5 minutes.
- **Candle history** is stored in the GitHub Actions cache, not in the repository. If the cache is ever cleared, the scanner rebuilds it with 5 requests.
- **Published data:** only the setups, grades, probabilities, levels and backtest results are published, on a branch called `data`. Candle history is never published.

## Optional settings

Add lines under `env:` in the Scan step of `.github/workflows/scan.yml`:

- `ALERTGRADES: A,B,C` to also get C setups. Default is `A,B`.
- `COST: 0.5` to change the trading cost per ounce used in backtests. Default is `0.35`.

## Event windows

Edit `config/events.json` to list high impact news (see `config/events.example.json`). From 30 minutes before to 60 minutes after each event, every grade is capped at B. Times are UTC.

## Things to know

- **Timing:** GitHub can delay scheduled runs by up to about 15 minutes at busy times, so this suits 5 minute and slower setups, not scalping.
- **Inactivity:** GitHub switches off scheduled workflows after 60 days without repository activity. If alerts stop, open the Actions tab and re-enable the workflow.
- **Public repository:** anyone with the link can see the code and the setups page. Do not put keys in any file. They belong only in secrets.
- **Twelve Data terms:** the free plan is for internal use. The page shows derived setups, not a price feed. Check Twelve Data's terms if you plan to share the page.
- **Prices:** Twelve Data's gold feed will differ from your broker's by a little. Check entry, stop and target against your own platform before trading.
- **Not advice:** these are backtested signals. Backtests assume a stop is hit before a target when both fall inside one candle, and they cannot account for gaps or slippage.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| No Telegram message | Actions tab, open the latest scan run, read the Scan step. Confirm you pressed Start in your bot and that the chat id is only the number. |
| Run fails saying TWELVEDATAKEY | The secret is missing or misspelled. |
| Page says waiting for the first scan | Wait for the first run to finish. Then open `https://raw.githubusercontent.com/YOURUSERNAME/gold-scanner/data/latest.json`. If that shows text, the page will load. |
| Page shows scan delayed | GitHub is running late. It recovers by itself. |

## Developing

`npm test` runs the scanner against a mocked Twelve Data and Telegram. `scan/engine.js` is a copy of the dashboard engine, so strategy changes made there carry over.
