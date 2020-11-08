import {selectAll} from 'hast-util-select';
import {Root} from 'hast';

const zeroIfUndefined = (value?: string): number =>
	value === undefined ? 0 : Number(value);

type propertiesType = Record<string, string>;

export default function flatten(svg: Root) {
	const flattenElements = <T>({
		tag,
		deserialize,
		translateFn,
		rotateFn,
		serialize
	}: {
		tag: string;
		deserialize: (properties: propertiesType) => T;
		translateFn: (ctx: T, x: number, y: number) => void;
		rotateFn: (
			ctx: T,
			rotator: (x: number, y: number) => {x: number; y: number}
		) => void;
		serialize: (ctx: T, properties: propertiesType) => void;
	}) => {
		for (const {properties} of selectAll(`${tag}[transform]`, svg, 'svg') as [
			{properties: propertiesType}
		]) {
			const ctx = deserialize(properties);

			for (const [_, func, args] of Array.from(
				properties.transform.matchAll(/ *([a-z]+) *\(([^)]*)\) */g)
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
							ctx,
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

						const angleNumber = (Number(rotateArgs[1]) * Math.PI) / 180;
						let rotateX: string | number | undefined = rotateArgs[3];

						const s = Math.sin(angleNumber);
						const c = Math.cos(angleNumber);

						const rotator = (x: number, y: number) => ({
							x: x * c - y * s,
							y: x * s + y * c
						});

						if (rotateX === undefined) {
							rotateFn(ctx, rotator);
						} else {
							rotateX = Number(rotateX);
							const rotateY = Number(rotateArgs[4]);

							translateFn(ctx, -rotateX, -rotateY);
							rotateFn(ctx, rotator);
							translateFn(ctx, rotateX, rotateY);
						}

						break;
					}

					default:
						throw new Error(`Unsupported transform function: ${func}`);
				}
			}

			serialize(ctx, properties);

			delete (properties as {transform?: string}).transform;
		}
	};

	for (const element of selectAll('rect[transform]', svg, 'svg') as [
		{tagName: string; properties: Record<string, string>}
	]) {
		element.tagName = 'path';
		const width = zeroIfUndefined(element.properties.width);
		const height = zeroIfUndefined(element.properties.height);
		const rxString = element.properties.rx;
		const ryString = element.properties.ry;
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

	flattenElements<{x: number; y: number}>({
		tag: 'circle',
		deserialize: ({cx, cy}) => ({
			x: zeroIfUndefined(cx),
			y: zeroIfUndefined(cy)
		}),
		translateFn(ctx, x, y) {
			ctx.x += x;
			ctx.y += y;
		},
		rotateFn(ctx, rotator) {
			const result = rotator(ctx.x, ctx.y);
			ctx.x = result.x;
			ctx.y = result.y;
		},
		serialize(ctx, properties) {
			if (ctx.x === 0) {
				delete properties.cx;
			} else {
				properties.cx = ctx.x.toString();
			}

			if (ctx.y === 0) {
				delete properties.cy;
			} else {
				properties.cy = ctx.y.toString();
			}
		}
	});

	flattenElements<{
		cmds: Array<{cmd: string; args: number[]}>;
		absIndices: Set<number>;
	}>({
		tag: 'path',
		deserialize({d}) {
			const absIndices: Set<number> = new Set();
			// Relative commands in the start of a path are considered absolute
			let initPath = true;
			const cmds = [
				...d.matchAll(/[\s,]*([mzlhvcsqta])(([\s,]*[+-]?[\d.e]+)*)/gi)
			].map(([_a, cmd, args], ind) => {
				if (cmd === 'Z' || cmd === 'z') {
					initPath = true;
				} else if (initPath || cmd === cmd.toUpperCase()) {
					absIndices.add(ind);
					initPath = false;
				}

				let numberArgs: number[];
				if (cmd.toUpperCase() === 'A') {
					const result = /(\d*\.?\d+(e[-+]?\d+)?)[\s,]*(\d*\.?\d+(e[-+]?\d+)?)[\s,]*([+-]?\d*\.?\d+(e[-+]?\d+)?)[\s,]+([01])[\s,]*([01])[\s,]*([+-]?\d*\.?\d+(e[-+]?\d+)?)[\s,]*([+-]?\d*\.?\d+(e[-+]?\d+)?)/i.exec(
						args
					) as string[];
					numberArgs = [
						result[1],
						result[3],
						result[5],
						result[7],
						result[8],
						result[9],
						result[11]
					].map((arg) => Number(arg));
				} else {
					numberArgs = [
						...args.matchAll(/[\s,]*([-+]?\d*\.?\d+(e[-+]?\d+)?)/gi)
					].map(([_, string]) => Number(string));
				}

				return {
					cmd,
					args: numberArgs
				};
			});
			return {cmds, absIndices};
		},
		translateFn({cmds, absIndices}, x, y) {
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
		},
		rotateFn({cmds, absIndices}, rotator) {
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
						cursorPt.x += cmd.args[cmd.args.length - 1];
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
						cursorPt.y += cmd.args[cmd.args.length - 1];
						flattenHV((arg) => [0, arg]);
						setFirstPt();
						break;
					case 'A':
					case 'a': {
						const result = rotator(cmd.args[5], cmd.args[6]);
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
		},
		serialize(ctx, properties) {
			properties.d = ctx.cmds
				.map(({cmd, args}) => `${cmd} ${args.join()}`)
				.join(' ');
		}
	});

	return svg;
}
