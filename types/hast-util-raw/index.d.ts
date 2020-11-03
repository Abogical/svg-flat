declare module '~hast-util-raw/index' {
  import { Node } from 'hast'
  export default function raw(tree: Node): Node
}

declare module 'hast-util-raw' {
  import alias = require('~hast-util-raw/index')
  export = alias
}
