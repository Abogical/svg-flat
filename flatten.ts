import {select, selectAll} from 'hast-util-select';
import * as Hast from 'hast';

export function flatten(svg: Hast.Root) {
	for (const {tagName} of selectAll<Hast.Element>(
		':not(g,rect,circle,path,ellipse,use)[transform]',
		svg,
		'svg'
	)) {
		console.warn(
			`flattening tag ${tagName} transform attribute is unsupported`
		);
	}

	for (const group of selectAll<Hast.Element>('g[transform]', svg, 'svg')) {
		flattenGroup(group);
	}

	for (const rect of selectAll<Hast.Element>('rect[transform]', svg, 'svg')) {
		rectToPath(rect);
	}

	for (const ellipse of selectAll<Hast.Element>(
		'ellipse[transform]',
		svg,
		'svg'
	)) {
		ellipseToPath(ellipse);
	}

	for (const use of selectAll<Hast.Element>(
		'use[transform][href],use[transform][xLinkHref]',
		svg,
		'svg'
	)) {
		const hrefMatch = /#(\S+)/g.exec(
			(use.properties.href ?? use.properties.xLinkHref) as string
		);
		if (hrefMatch !== null) {
			const usedElement = select<Hast.Element>(
				`[id~=${hrefMatch[1]}]`,
				svg,
				'svg'
			);
			if (usedElement !== null) {
				use.tagName = usedElement.tagName;
				for (const [key, value] of Object.entries(usedElement.properties)) {
					use.properties[key] = `${use.properties[key] as string} ${
						value as string
					}`;
				}
			}

			delete use.properties.xLinkHref;
			delete use.properties.href;
		}
	}

	for (const circle of selectAll<Hast.Element>(
		'circle[transform]',
		svg,
		'svg'
	)) {
		circleToPath(circle);
	}

	for (const path of selectAll<Hast.Element>(
		'path[d][transform]',
		svg,
		'svg'
	)) {
		flattenPath(path);
	}

	return svg;
}

function flattenPath(element: Hast.Element): void {
	const absIndices: Set<number> = new Set();
	const d = element.properties.d;
	// Relative commands in the start of a path are considered absolute
	const cmds = isString(d)
		? [...d.matchAll(/[\s,]*([mzlhvcsqta])(([\s,]*[+-]?[\d.e]+)*)/gi)].map(
				([_a, cmd, args], ind) => {
					if (ind === 0 || cmd === cmd.toUpperCase()) {
						absIndices.add(ind);
					}

					const numberArgs =
						cmd.toUpperCase() === 'A'
							? [
									...args.matchAll(
										/(\d*\.?\d+(e[-+]?\d+)?)[\s,]*(\d*\.?\d+(e[-+]?\d+)?)[\s,]*([+-]?\d*\.?\d+(e[-+]?\d+)?)[\s,]+([01])[\s,]*([01])[\s,]*([+-]?\d*\.?\d+(e[-+]?\d+)?)[\s,]*([+-]?\d*\.?\d+(e[-+]?\d+)?)/gi
									)
							  ]
									.flatMap((result) => [
										result[1],
										result[3],
										result[5],
										result[7],
										result[8],
										result[9],
										result[11]
									])
									.map((arg) => Number(arg))
							: [
									...args.matchAll(/[\s,]*([-+]?\d*\.?\d+(e[-+]?\d+)?)/gi)
							  ].map(([_, string]) => Number(string));

					return {
						cmd,
						args: numberArgs
					};
				}
		  )
		: [];

	const transformAttribute: string = isString(element.properties.transform)
		? element.properties.transform
		: '';

	const translateFn = (x: number, y: number) => {
		for (const ind of absIndices) {
			const {cmd, args} = cmds[ind];
			switch (cmd) {
				case 'H':
					for (let i = 0; i < args.length; i++) {
						args[i] += x;
					}

					break;
				case 'V':
					for (let i = 0; i < args.length; i++) {
						args[i] += y;
					}

					break;
				case 'A':
					args[5] += x;
					args[6] += y;
					break;
				default:
					for (let i = 0; i < args.length; ) {
						args[i++] += x;
						args[i++] += y;
					}
			}
		}
	};

	for (const [_, func, args] of Array.from(
		transformAttribute.matchAll(/ *([a-z]+) *\(([^)]*)\) */g)
	).reverse()) {
		switch (func) {
			case 'translate': {
				const translateArgs = /^ *([+-]?[\d.e]*) *,? *([+-]?[\d.e]*)? *$/i.exec(
					args
				);
				if (translateArgs === null) {
					throw new Error(`Invalid translate arguments: ${args}`);
				}

				translateFn(
					Number(translateArgs[1]),
					zeroIfUndefined(translateArgs[2])
				);

				break;
			}

			case 'rotate': {
				const rotateArgs = /^ *([+-]?[\d.e]*) *,? *(([+-]?[\d.e]*) *,? *([+-]?[\d.e]*))? *$/i.exec(
					args
				);
				if (rotateArgs === null) {
					throw new Error(`Invalid rotate arguments: ${args}`);
				}

				const angleDegrees = Number(rotateArgs[1]);
				const angleRad = (angleDegrees * Math.PI) / 180;
				let rotateX: string | number | undefined = rotateArgs[3];

				const s = Math.sin(angleRad);
				const c = Math.cos(angleRad);

				const rotator = (x: number, y: number) => ({
					x: x * c - y * s,
					y: x * s + y * c
				});

				const rotateFn = () => {
					let cursorPt = {x: 0, y: 0};
					let firstPt: {x: number; y: number} | null = null;

					const setFirstPt = () => {
						if (firstPt === null) {
							firstPt = {...cursorPt};
						}
					};

					for (const [ind, cmd] of cmds.entries()) {
						// Update cursor point for H & V commands

						switch (cmd.cmd.toUpperCase()) {
							case 'Z':
								if (firstPt !== null) {
									cursorPt = firstPt;
									firstPt = null;
								}

								break;
							default: {
								const cmdX = cmd.args[cmd.args.length - 2];
								const cmdY = cmd.args[cmd.args.length - 1];
								if (cmd.cmd === cmd.cmd.toUpperCase()) {
									cursorPt.x = cmdX;
									cursorPt.y = cmdY;
								} else {
									cursorPt.x += cmdX;
									cursorPt.y += cmdY;
								}

								setFirstPt();
								break;
							}

							case 'H':
							case 'V':
						}

						const flattenHV = (getXY: (arg: number) => [number, number]) => {
							cmd.cmd = 'l';
							cmd.args = cmd.args.flatMap((arg) => {
								const result = rotator(...getXY(arg));
								return [result.x, result.y];
							});
						};

						switch (cmd.cmd) {
							case 'H': {
								const lastX = cmd.args[cmd.args.length - 1];
								const cursorX = cursorPt.x;
								flattenHV((arg) => [arg - cursorX, 0]);
								cursorPt.x = lastX;
								setFirstPt();
								absIndices.delete(ind);
								break;
							}

							case 'h': {
								for (const arg of cmd.args) {
									cursorPt.x += arg;
								}

								flattenHV((arg) => [arg, 0]);
								setFirstPt();
								break;
							}

							case 'V': {
								const lastY = cmd.args[cmd.args.length - 1];
								const cursorY = cursorPt.y;
								flattenHV((arg) => [0, arg - cursorY]);
								cursorPt.y = lastY;
								setFirstPt();
								absIndices.delete(ind);
								break;
							}

							case 'v':
								for (const arg of cmd.args) {
									cursorPt.y += arg;
								}

								flattenHV((arg) => [0, arg]);
								setFirstPt();
								break;
							case 'A':
							case 'a': {
								const result = rotator(cmd.args[5], cmd.args[6]);
								cmd.args[2] += angleDegrees;
								cmd.args[5] = result.x;
								cmd.args[6] = result.y;
								break;
							}

							default:
								for (let i = 0; i < cmd.args.length; ) {
									const result = rotator(cmd.args[i], cmd.args[i + 1]);
									cmd.args[i++] = result.x;
									cmd.args[i++] = result.y;
								}
						}
					}
				};

				if (rotateX === undefined) {
					rotateFn();
				} else {
					rotateX = Number(rotateX);
					const rotateY = Number(rotateArgs[4]);

					translateFn(-rotateX, -rotateY);
					rotateFn();
					translateFn(rotateX, rotateY);
				}

				break;
			}

			case 'scale': {
				const scaleArgs = /^ *([+-]?[\d.e]*) *,? *([+-]?[\d.e]*)? *$/i.exec(
					args
				);
				if (scaleArgs === null) {
					throw new Error(`Invalid scale arguments: ${args}`);
				}

				const x = Number(scaleArgs[1]);
				const yString = scaleArgs[2];
				const y = yString === undefined ? x : Number(yString);

				for (const {cmd, args} of cmds) {
					switch (cmd.toUpperCase()) {
						case 'H':
							for (let i = 0; i < args.length; i++) {
								args[i] *= x;
							}

							break;
						case 'V':
							for (let i = 0; i < args.length; i++) {
								args[i] *= y;
							}

							break;
						case 'A':
							args[5] *= x;
							args[6] *= y;
							break;
						default:
							for (let i = 0; i < args.length; ) {
								args[i++] *= x;
								args[i++] *= y;
							}
					}
				}

				break;
			}

			default:
				throw new Error(`Unsupported transform function: ${func}`);
		}
	}

	element.properties.d = cmds
		.map(({cmd, args}) => `${cmd} ${args.join()}`)
		.join(' ');

	delete element.properties.transform;
}

function zeroIfUndefined(value?: unknown): number {
	return value === undefined ? 0 : Number(value);
}

function flattenGroup(
	element: Hast.Element | Hast.Comment | Hast.Text | Hast.Raw
): void {
	if (element.type === 'element') {
		if (!isString(element.properties.transform)) {
			return;
		}

		const transform = element.properties.transform;

		for (const child of element.children.filter(
			(child) => child.properties !== undefined
		) as Hast.Element[] & Array<{properties: {transform?: string}}>) {
			child.properties.transform = `${transform} ${
				child.properties.transform ?? ''
			}`;
			if (child.tagName === 'g' || child.tagName === 'mask')
				flattenGroup(child);
		}

		delete element.properties.transform;
	}
}

function rectToPath(element: Hast.Element): void {
	element.tagName = 'path';
	const width = zeroIfUndefined(element.properties.width);
	const height = zeroIfUndefined(element.properties.height);
	const {rx, ry} = getRXY(element);

	const curve = (x: number, y: number) =>
		rx || ry ? `a${rx},${ry},0,0,1,${x},${y}` : '';
	element.properties.d = `M${
		zeroIfUndefined(element.properties.x) + rx
	},${zeroIfUndefined(element.properties.y)}h${width - 2 * rx}${curve(
		rx,
		ry
	)}v${height - 2 * ry}${curve(-rx, ry)}h${2 * rx - width}${curve(-rx, -ry)}${
		rx || ry ? `v${2 * ry - height}` : ''
	}${curve(rx, -ry)}z`;
	delete element.properties.x;
	delete element.properties.y;
	delete element.properties.width;
	delete element.properties.height;
	delete element.properties.rx;
	delete element.properties.ry;
}

function ellipseToPath(element: Hast.Element): void {
	element.tagName = 'path';
	const {rx, ry} = getRXY(element);
	setEllipsePath(element, rx, ry);
	delete element.properties.cx;
	delete element.properties.cy;
	delete element.properties.rx;
	delete element.properties.ry;
}

function circleToPath(element: Hast.Element): void {
	element.tagName = 'path';
	const r = zeroIfUndefined(element.properties.r);
	setEllipsePath(element, r, r);
	delete element.properties.r;
	delete element.properties.cx;
	delete element.properties.cy;
}

function setEllipsePath(element: Hast.Element, rx: number, ry: number) {
	element.properties.d = `M${
		zeroIfUndefined(element.properties.cx) + rx
	},${zeroIfUndefined(element.properties.cy)}a${rx},${ry},0,1,1,${
		-2 * rx
	},0a${rx},${ry},0,1,1,${2 * rx},0z`;
}

function getRXY({properties}: Hast.Element): {rx: number; ry: number} {
	const rxString = properties.rx;
	const ryString = properties.ry;
	let rx = 0;
	let ry = 0;
	if (rxString === undefined) {
		if (ryString !== undefined) {
			ry = Number(ryString);
			rx = ry;
		}
	} else {
		rx = Number(rxString);
		ry = ryString === undefined ? rx : Number(ryString);
	}

	return {rx, ry};
}

function isString(test: unknown): test is string {
	return {}.toString.call(test) === '[object String]';
}
