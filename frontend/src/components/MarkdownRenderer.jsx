import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Box } from '@mui/material';

const MarkdownRenderer = memo(({ content }) => {
  return (
    <Box sx={{ '& img': { maxWidth: '100%' } }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </Box>
  );
});

export default MarkdownRenderer;