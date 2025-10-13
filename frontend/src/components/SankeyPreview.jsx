import React from 'react';
import { Sankey, ResponsiveContainer, Tooltip, Layer, Rectangle } from 'recharts';

// 虚拟数据，模拟资金流向
const data = {
  nodes: [
    { name: "客户A回款 (¥800)" },
    { name: "客户B回款 (¥1000)" },
    { name: "张三-7月账单" },
    { name: "李四-7月账单" },
    { name: "张三-8月账单" },
  ],
  links: [
    { source: 0, target: 2, value: 500 },
    { source: 0, target: 4, value: 300 },
    { source: 1, target: 3, value: 800 },
    { source: 1, target: 4, value: 200 },
  ],
};

// 自定义节点组件，使其更美观
const CustomNode = ({ x, y, width, height, index, payload }) => {
  return (
    <Layer key={`CustomNode${index}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill="#26A69A" // 使用主题色
        fillOpacity="1"
      />
      <text
        textAnchor="middle"
        x={x + width / 2}
        y={y + height / 2 + 4} // 垂直居中
        fill="#fff" // 白色字体
        fontSize="14"
      >
        {payload.name}
      </text>
    </Layer>
  );
};

const SankeyPreview = () => {
  return (
    <div style={{ width: '100%', height: 600, backgroundColor: '#f7fafc', padding: '20px' }}>
      <h2 style={{ textAlign: 'center', color: '#525f7f' }}>回款分配预览 (虚拟数据)</h2>
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={data}
          nodePadding={50}
          margin={{
            left: 150,
            right: 150,
            top: 40,
            bottom: 40,
          }}
          link={{ stroke: '#B0BEC5', strokeOpacity: 0.5 }}
          node={<CustomNode />}
        >
          <Tooltip 
            cursor={{ stroke: 'red', strokeWidth: 2 }}
            formatter={(value, name, props) => {
              const { source, target } = props.payload;
              return `${source.name} -> ${target.name}: ¥${value}`;
            }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
};

export default SankeyPreview;