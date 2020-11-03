declare module 'hast-util-to-html' {
  import { Node } from 'hast'
  export default function toHTML(node: Node, options?: {space: string}): string
}
