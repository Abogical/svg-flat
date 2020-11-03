import test from 'tape';
import flatten from '../flatten';
import hastParser from 'hast-util-raw'
import toHTML from 'hast-util-to-html'
import {matches} from 'hast-util-select'
import {Root} from 'hast'
import path from 'path';
import fs from 'fs';

const outDir = path.join(__dirname, 'out')
fs.mkdirSync(outDir, {recursive: true})

const testFile = (fileName: string) => test(path.join('fixtures', fileName), t => {
  t.plan(1)
  const input = hastParser({type: 'root', children: [{type: 'raw', value: fs.readFileSync(path.join(__dirname, 'fixtures', fileName), 'utf-8')}]})
  flatten(input as Root);
  fs.writeFileSync(path.join(outDir, fileName), toHTML(input, {space: 'svg'}))
  t.false(matches('circle[transform]', input, 'svg'))
})

testFile('simple.svg')
