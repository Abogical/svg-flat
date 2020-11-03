import { selectAll } from 'hast-util-select'
import { Root } from 'hast';

const zeroIfUndefined = (val?: string): number => val === undefined? 0 : Number(val);

export default function flatten(svg: Root) {

  selectAll('circle[transform]', svg, 'svg').map(({properties}: {properties: {transform: string, cx?:string, cy?:string}}) => {
    let xRes = zeroIfUndefined(properties.cx);
    let yRes = zeroIfUndefined(properties.cy);

    for (const [_, func, args] of Array.from(properties.transform.matchAll(/ *([a-z]+) *\(([^\)]*)\) */g)).reverse()){
      switch(func){
        case 'translate':
          const translateArgs = /^ *(-?\d+) *,? *(-?\d+)? *$/.exec(args)
          if(!Array.isArray(translateArgs))
            throw `Invalid translate arguments: ${args}`

          xRes += Number(translateArgs[1]);
          const translateY = translateArgs[2]
          if(translateY !== undefined) yRes += Number(translateY);
          break;

        case 'rotate':
          const rotateArgs = /^ *(-?\d+) *,? *((-?\d+) *,? *(-?\d+))? *$/.exec(args)
          if(!Array.isArray(rotateArgs))
            throw `Invalid rotate arguments: ${args}`

          const angleNum = Number(rotateArgs[1])*Math.PI/180
          let rotateX: string | number | undefined = rotateArgs[3]

          const s = Math.sin(angleNum)
          const c = Math.cos(angleNum)

          const rotateRes = () => {
            const xTmp = xRes;
            xRes = xRes*c - yRes*s
            yRes = xTmp*s + yRes*c
          }

          if(rotateX !== undefined) {
            rotateX = Number(rotateX)
            const rotateY = Number(rotateArgs[4])

            xRes -= rotateX
            yRes -= rotateY

            rotateRes()

            xRes += rotateX
            yRes += rotateY
          }else rotateRes()
          break;
        default:
          throw `Unsupported transform function: ${func}`
      }
    }

    if(xRes === 0) delete properties.cx; else properties.cx = xRes.toString();
    if(yRes === 0) delete properties.cy; else properties.cy = yRes.toString();
    
    delete (properties as {transform?: string}).transform
  })

  return svg;
}
