import { selectAll } from 'hast-util-select'
import { Root } from 'hast';

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
  
  for (const elem of selectAll('rect[transform]', svg, 'svg') as [{tagName: string, properties: {[key: string]: string}}]){
    elem.tagName = 'path'
    const width = zeroIfUndefined(elem.properties.width)
    const height = zeroIfUndefined(elem.properties.height)
    const rxStr = elem.properties.rx
    const ryStr = elem.properties.ry
    let rx = 0, ry = 0
    if(rxStr === undefined){
      if(ryStr !== undefined){
        ry = Number(ryStr)
        rx = ry
      }
    }else{
      rx = Number(rxStr)
      ry = ryStr === undefined? rx : Number(ryStr)
    }
    console.log(rx, ry)
    const curve = (x: number, y: number) => (rx || ry)? `a${rx},${ry},0,0,1,${x},${y}`: ''
    elem.properties.d = `M${zeroIfUndefined(elem.properties.x)+rx},${zeroIfUndefined(elem.properties.y)}h${width-2*rx}${curve(rx,ry)}v${height-2*ry}${curve(-rx,ry)}h${2*rx-width}${curve(-rx,-ry)}${(rx || ry) ? `v${2*ry-height}`: ''}${curve(rx, -ry)}z`
    console.log(elem.properties.d)
    delete elem.properties.x
    delete elem.properties.y
    delete elem.properties.width
    delete elem.properties.height
    delete elem.properties.rx
    delete elem.properties.ry
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
    let absIndices: Set<number> = new Set()
    // Relative commands in the start of a path are considered absolute
    let initPath = true;
    const cmds = [...d.matchAll(/[\s,]*([MZLHVCSQTA])(([\s,]*[+-]?[\d\.e]+)*)/gi)].map(
      ([_a, cmd, args], ind) => {
        if(cmd == 'Z' || cmd == 'z'){
          initPath = true
        }else if(initPath || cmd == cmd.toUpperCase()){
          absIndices.add(ind)
          initPath = false
        }
        let numArgs: number[]
        if(cmd.toUpperCase() === 'A'){
          const res = args.match(/(\d*\.?\d+([e][-+]?\d+)?)[\s,]*(\d*\.?\d+([e][-+]?\d+)?)[\s,]*([+-]?\d*\.?\d+([e][-+]?\d+)?)[\s,]+([01])[\s,]*([01])[\s,]*([+-]?\d*\.?\d+([e][-+]?\d+)?)[\s,]*([+-]?\d*\.?\d+([e][-+]?\d+)?)/i) as string[]
          numArgs = [res[1], res[3], res[5], res[7], res[8], res[9], res[11]].map(Number)
        }else{
          numArgs = [...args.matchAll(/[\s,]*([-+]?\d*\.?\d+([e][-+]?\d+)?)/gi)].map(([_, str]) => Number(str))
        }
        return ({
          cmd,
          args: numArgs
        })
      }
    )
    return {cmds, absIndices}
  }, ({cmds, absIndices}, x, y) => {
    for(const ind of absIndices){
      const {cmd, args} = cmds[ind]
      switch(cmd){
        case 'H':
          for(let i = 0; i < args.length; i++) args[i] += x
          break
        case 'V':
          for(let i = 0; i < args.length; i++) args[i] += y
          break
        case 'A':
          args[5] += x
          args[6] += y
          break
        default:
          for(let i = 0; i < args.length;){
            args[i++] += x
            args[i++] += y
          }
      }
    }
  }, ({cmds, absIndices}, rotator) => {
    let cursorPt = {x: 0, y: 0}
    let firstPt: {x: number, y: number} | null = null
    for(const [ind, cmd] of cmds.entries()){
      // Update cursor point for H & V commands
      const setFirstPt = () => {
        if(firstPt === null) firstPt = {...cursorPt}
      }
      switch(cmd.cmd.toUpperCase()){
        case 'Z':
          if(firstPt !== null) {
            cursorPt = firstPt
            firstPt = null
          }
          break
        default:
          const cmdX = cmd.args[cmd.args.length-2], cmdY = cmd.args[cmd.args.length-1]
          if(cmd.cmd === cmd.cmd.toUpperCase()){
            cursorPt.x = cmdX
            cursorPt.y = cmdY
          }else{
            cursorPt.x += cmdX
            cursorPt.y += cmdY
          }
          setFirstPt()
        case 'H':
        case 'V':
      }
      const flattenHV = (getXY: (arg: number) => [number, number]) => {
        cmd.cmd = 'l'
        cmd.args = cmd.args.flatMap(arg => {
          const res = rotator(...getXY(arg))
          return [res.x, res.y]
        })
      }
      switch(cmd.cmd){
        case 'H':
          const lastX = cmd.args[cmd.args.length-1]
          flattenHV((arg) => [arg-cursorPt.x, 0])
          cursorPt.x = lastX
          setFirstPt()
          absIndices.delete(ind)
          break
        case 'h':
          cursorPt.x += cmd.args[cmd.args.length-1]
          flattenHV((arg) => [arg, 0])
          setFirstPt()
          break
        case 'V':
          const lastY = cmd.args[cmd.args.length-1]
          flattenHV((arg) => [0, arg-cursorPt.y])
          cursorPt.y = lastY
          setFirstPt()
          absIndices.delete(ind)
          break
        case 'v':
          cursorPt.y += cmd.args[cmd.args.length-1]
          flattenHV((arg) => [0, arg])
          setFirstPt()
          break
        case 'A':
        case 'a':
          const res = rotator(cmd.args[5], cmd.args[6])
          cmd.args[5] = res.x
          cmd.args[6] = res.y
          break
        default:
          for(let i = 0; i < cmd.args.length;){
            const res = rotator(cmd.args[i], cmd.args[i+1])
            cmd.args[i++] = res.x
            cmd.args[i++] = res.y
          }
      }
    }
  }, (ctx, properties) => {
    properties.d = ctx.cmds.map(({cmd, args}) => `${cmd} ${args.join()}`).join(' ')
  })

  return svg;
}
