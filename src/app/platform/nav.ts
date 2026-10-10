/**
 * 应用内“返回深度”计数：hash 导航与浮层 pushState 各占一层，popstate 回退一层。
 * 仅原生壳的返回键处理使用；浏览器自身的返回行为不变。
 */
let depth = 0;
export const navDepth = () => depth;
export const trackNavPush = () => {
  depth++;
};
export const trackNavPop = () => {
  depth = Math.max(0, depth - 1);
};
