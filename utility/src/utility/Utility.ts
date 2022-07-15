
const generatePortionQueue = <T>(array: T[]) => {
    return {
        getPortionQueue: (portionCount: number) => {
            const skuQueue = [] as T[][];

            const portion = Math.ceil(array.length / portionCount);

            for (let i = 0; i < portionCount; i++) {
                if (i === 0) {
                    skuQueue.push(array.slice(0, portion));
                }
                else if (i === portionCount - 1) {
                    skuQueue.push(array.slice(portion * (portionCount - 1), array.length));
                }
                else {
                    skuQueue.push(array.slice(portion * i, portion * (i + 1)));
                }
            }
            return skuQueue;
        }
    }
}

export { generatePortionQueue }
