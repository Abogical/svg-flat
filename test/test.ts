import test from 'tape';
import flatten from '../flatten';
import hastParser from 'hast-util-raw'
import toHTML from 'hast-util-to-html'
import {matches} from 'hast-util-select'
import {Root} from 'hast'
import path from 'path';
import fs from 'fs';
import sharp from 'sharp'
import pixelmatch from 'pixelmatch'

const outDir = path.join(__dirname, 'out')
fs.mkdirSync(outDir, {recursive: true})

const testFile = (fileName: string) => test(path.join('fixtures', fileName), async t => {
  t.plan(4)
  const srcImagePath = path.join(__dirname, 'fixtures', fileName)
  const input = hastParser({type: 'root', children: [{type: 'raw', value: fs.readFileSync(srcImagePath, 'utf-8')}]})
  flatten(input as Root);
  // Test if all tranform attributes are removed
  t.notOk(matches('circle[transform]', input, 'svg'), 'output svg has no transform attribute on circle elements')
  t.notOk(matches('path[transform]', input, 'svg'), 'output svg has no transform attribute on path elements')
  t.notOk(matches('rect[transform]', input, 'svg'), 'output svg has no transform attribute on rect elements')  

  const destImagePath = path.join(outDir, fileName)
  fs.writeFileSync(destImagePath, toHTML(input, {space: 'svg'}))
  const destRaw = sharp(destImagePath).raw().toBuffer()
  const {data: srcRaw, info: {width, height}} = await sharp(srcImagePath).raw().toBuffer({resolveWithObject: true})
  t.equal(pixelmatch(srcRaw, await destRaw, null, width, height), 0, 'Output and input images are equivalent')
})

testFile('simple.svg')
