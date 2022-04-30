#!/usr/bin/node

const src = 'https://www.mil.gov.ua/archive?page=1';
const tsvFile = 'orks-losses.tsv';
const patternSuffix = '\\s*[-–‒]\\s*(?:близько |до |понад )?(\\d+)( \\(\\+\\d+\\))?( од(иниц[іья])?| осіб( ліквідовано)?)?[.,]?\\s+';

const fs = require('fs');
const puppeteer = require('puppeteer');

// Functions.
const stripQuotes = str =>
  str.length >= 2 && str.at(0) === '"' && str.at(-1) === '"'
    ? str.substring(1, str.length - 1)
    : str;
const setUTCNoon = date => date.setUTCHours(12, 0, 0, 0);
const incrementDay = date => {
  date.setDate(date.getDate() + 1);
  return setUTCNoon(date);
}

// Parse the datafile to get loss types and the last report date.
const tsvLines = fs.readFileSync(tsvFile, 'utf8').trim().split("\n");
const types = tsvLines[0].split("\t").slice(1, -1).map(stripQuotes);
const lastDate = stripQuotes(tsvLines.at(-1).split("\t").at(0));

// This constructs the UTC time of 00:00:00.000. Set it to the noon to avoid
// problems with the DST when it increments day by day.
const nextDate = new Date(lastDate);
setUTCNoon(nextDate);
incrementDay(nextDate);

const today = new Date();
setUTCNoon(today);

// Check if the datafile is up-to-date.
if (nextDate > today) {
  console.log('Up-to-date');
  return;
}

(async () => {
  const browser = await puppeteer.launch({headless: false});
  const page = await browser.newPage();

  await page.goto(src);

  const list = await page.$eval('#aticle-content', (container, nextDate) => {
    nextDate = new Date(nextDate);
    const list = {};
    let year = null;
    const monthNames = {};
    const setUTCNoon = date => date.setUTCHours(12, 0, 0, 0);

    const tmpDate = new Date();
    tmpDate.setDate(1);

    for (let i = 0; i < 12; i++) {
      tmpDate.setMonth(i);
      monthNames[tmpDate.toLocaleString('uk-UA', {month: 'long'})] = (i + 1).toString(10).padStart(2, '0');
    }

    for (const child of container.children) {
      const tag = child.tagName.toLowerCase();

      if (tag === 'h3') {
        year = parseInt(child.childNodes[0].textContent.trim(), 10);

        if (year < nextDate.getUTCFullYear()) {
          year = null;
          break;
        }
      }
      else if (tag === 'ul' && year) {
        for (const liMonth of child.children) {
          const ym = year + '-' + monthNames[liMonth.querySelector('h4').childNodes[0].textContent.trim().toLowerCase()];
          const lastDayOfMonth = new Date(ym + '-01');
          setUTCNoon(lastDayOfMonth);
          lastDayOfMonth.setMonth(lastDayOfMonth.getMonth() + 1);
          lastDayOfMonth.setDate(lastDayOfMonth.getDate() - 1);
          setUTCNoon(lastDayOfMonth);

          if (lastDayOfMonth < nextDate) {
            break;
          }

          for (const liDay of liMonth.children[1].children) {
            const ymd = ym + '-' + liDay.querySelector('h5').childNodes[0].textContent.trim().padStart(2, '0');
            const day = new Date(ymd);
            setUTCNoon(day);

            if (day < nextDate) {
              break;
            }

            list[ymd] = Array.from(liDay.children[1].children)
              .filter(liPost => /втрат/i.test(liPost.textContent))
              .map(liPost => liPost.querySelector('a').href);
          }
        }

        year = null;
      }
    }

    return list;
  // Date object is not serializable.
  }, nextDate.valueOf());

  while (nextDate <= today) {
    const ymd = nextDate.toISOString().split('T')[0];
    console.log('-', ymd, '-');
    let dayData = null;

    if (list[ymd] !== undefined) {
      for (const url of list[ymd]) {
        await page.deleteCookie(...(await page.cookies()));
        await page.goto(url);
        await page.waitForSelector('#aticle-content', {visible: true});
        let post = await page.$eval('#aticle-content', container => container.textContent.trim());

        // Check if this is the post we need.
        if (/\sз 24\.02\s/.test(post)) {
          dayData = types.map(type => {
            let num = '';
            post = post.replace(new RegExp(type + patternSuffix, 'i'), (match, p1) => {
              num = p1;
              // Delete the finding from the full post.
              return '';
            });

            return num;
          });
          console.log(url);
          console.log('A post remainder:', post);

          dayData.unshift('"' + ymd + '"');
          dayData.push('"' + url + '"');
          fs.appendFileSync(tsvFile, dayData.join("\t") + "\n");
          break;
        }
      }
    }

    if (!dayData) {
      throw new Error('Missing data for ' + ymd);
    }

    incrementDay(nextDate);
  }

  await browser.close();
  console.log('OK');
})();
