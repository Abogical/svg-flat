import { selectAll } from 'hast-util-select'
import { Root } from 'hast';
import { stringify } from 'querystring';
import { serialize } from 'v8';
import { X_OK } from 'constants';

const zeroIfUndefined = (val?: string): number => val === undefined? 0 : Number(val);

type propertiesType = {[key:string]: string}

export default function flatten(svg: Root) {

  const flattenElements = <T>(tag: string, deserialize: (properties: propertiesType) => T, translateFn: (ctx: T, x: number, y: number) => void,
    rotateFn: (ctx: T, rotator: (x: number, y: number) => {x: number, y: number}) => void, serialize: (ctx: T, properties: propertiesType) => void) => {
    for(const {properties} of selectAll(`${tag}[transform]`, svg, 'svg') as [{properties: propertiesType}]){
      const ctx = deserialize(properties)

      for (const [_, func, args] of Array.from(properties.transform.matchAll(/ *([a-z]+) *\(([^\)]*)\) */g)).reverse()){
        switch(func){
          case 'translate':
            const translateArgs = /^ *([+-]?[\d\.e]*) *,? *([+-]?[\d\.e]*)? *$/i.exec(args)
            if(!Array.isArray(translateArgs))
              throw `Invalid translate arguments: ${args}`

            translateFn(ctx, Number(translateArgs[1]), zeroIfUndefined(translateArgs[2]))
            break;

          case 'rotate':
            const rotateArgs = /^ *([+-]?[\d\.e]*) *,? *(([+-]?[\d\.e]*) *,? *([+-]?[\d\.e]*))? *$/i.exec(args)
            if(!Array.isArray(rotateArgs))
              throw `Invalid rotate arguments: ${args}`

            const angleNum = Number(rotateArgs[1])*Math.PI/180
            let rotateX: string | number | undefined = rotateArgs[3]

            const s = Math.sin(angleNum)
            const c = Math.cos(angleNum)

            const rotator = (x: number, y: number) => ({
              x: x*c - y*s,
              y: x*s + y*c
            })

            if(rotateX !== undefined) {
              rotateX = Number(rotateX)
              const rotateY = Number(rotateArgs[4])

              translateFn(ctx, -rotateX, -rotateY)
              rotateFn(ctx, rotator)
              translateFn(ctx, rotateX, rotateY)
            }else rotateFn(ctx, rotator)
            break;
          default:
            throw `Unsupported transform function: ${func}`
        }
      }

      serialize(ctx, properties)
      
      delete (properties as {transform?: string}).transform
    }
  }
  
  flattenElements('circle', ({cx, cy}) => ({
    x: zeroIfUndefined(cx),
    y: zeroIfUndefined(cy)
  }), (ctx, x, y) => {
    ctx.x += x
    ctx.y += y
  }, (ctx, rotator) => {
    const res = rotator(ctx.x, ctx.y)
    ctx.x = res.x
    ctx.y = res.y
  }, (ctx, properties) => {
    if(ctx.x === 0) delete properties.cx; else properties.cx = ctx.x.toString();
    if(ctx.y === 0) delete properties.cy; else properties.cy = ctx.y.toString();
  })

  flattenElements('path', ({d}) => {
    let absIndices: Array<number> = []
    // Relative commands in the start of a path are considered absolute
    let initPath = true;
    const cmds = [...d.matchAll(/[\s,]*([MZLHVCSQTA])(([\s,]*[+-]?[\d\.e]+)*)/gi)].map(
      ([_a, cmd, args], ind) => {
        if(cmd == 'Z' || cmd == 'z'){
          initPath = true
        }else if(initPath || cmd == cmd.toUpperCase()){
          absIndices.push(ind)
          initPath = false
        }
        return ({
          cmd,
          args: [...args.matchAll(/[\s,]*([-+]?[0-9]*\.?[0-9]+([e][-+]?[0-9]+)?)/gi)].map(([str]) => Number(str))
        })
      }
    )
    return {cmds, absIndices}
  }, ({cmds, absIndices}, x, y) => {
    for(const ind of absIndices){
      const {cmd, args} = cmds[ind]
      if(cmd == 'A'){
        args[5] += x
        args[6] += y
      }else{
        for(let i = 0; i < args.length;){
          args[i++] += x
          args[i++] += y
        }
      }
    }
  }, ({cmds}, rotator) => {
    for(const {cmd, args} of cmds){
      if(cmd == 'A'){
        const res = rotator(args[5], args[6])
        args[5] = res.x
        args[6] = res.y
      }else{
        for(let i = 0; i < args.length;){
          const res = rotator(args[i], args[i+1])
          args[i++] = res.x
          args[i++] = res.y
        }
      }
    }
  }, (ctx, properties) => {
    properties.d = ctx.cmds.map(({cmd, args}) => `${cmd} ${args.join()}`).join(' ')
  })

  return svg;
}
