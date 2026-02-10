
import React from 'react';

export const MissionUI: React.FC = () => {
  return React.createElement(
    'div',
    { className: "bg-black/40 backdrop-blur-md border border-zinc-700/50 p-3 rounded-md flex flex-col gap-1 max-w-[240px] pointer-events-auto absolute bottom-4 right-4 shadow-2xl" },
    [
      React.createElement(
        'div',
        { key: 'header', className: "flex items-center gap-2" },
        [
          React.createElement('div', { key: 'pulse', className: "w-2 h-2 bg-red-500 animate-pulse rounded-full" }),
          React.createElement('h2', { key: 'title', className: "text-white text-[10px] font-mono font-bold tracking-widest uppercase" }, "作战日志")
        ]
      ),
      React.createElement(
        'div',
        { key: 'content', className: "text-zinc-400 text-[10px] font-mono leading-tight" },
        [
          React.createElement('p', { key: 'p1', className: "mb-1 text-yellow-500/80" }, "移动: A / D | 瞄准: 鼠标 | 缩放: 鼠标滚轮"),
          React.createElement('p', { key: 'p2', className: "mb-1 text-yellow-500/80" }, "主炮: 鼠标左键 | 机枪: Q (可自动射击)"),
          React.createElement('p', { key: 'p3', className: "mb-1 text-yellow-500/80" }, "迫击炮/核弹: 切换弹种后长按左键蓄力，松手发射"),
          React.createElement('p', { key: 'p4', className: "mb-1 text-yellow-500/80" }, "切换弹药: E | 长按空格: 远距瞄准 / 观测弹道"),
          React.createElement('p', { key: 'p5', className: "mb-1 text-emerald-300/90" }, "拦截: 用机枪或自己的炮弹命中敌方炮弹，可在空中引爆"),
          React.createElement('p', { key: 'p6', className: "mb-1 text-red-300/90" }, "地形: 爆炸会造成地形塌陷，深坑会困住战车和步兵"),
          React.createElement('p', { key: 'p7', className: "mb-1 text-sky-300/90" }, "环境: 雨水/沙尘暴会影响视野与气氛，但不会遮挡操作"),
          React.createElement('p', { key: 'p8' }, "提示: 起始3000米为安全基地，安全区内可整理部队与休整。")
        ]
      )
    ]
  );
};
