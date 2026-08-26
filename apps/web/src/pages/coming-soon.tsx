import { PageContainer, ProCard } from '@ant-design/pro-components';

export default function ComingSoonPage({ title }: { title: string }) {
  return (
    <PageContainer title={title}>
      <ProCard>该模块将在下一迭代落地，接口权限点已预置。</ProCard>
    </PageContainer>
  );
}
