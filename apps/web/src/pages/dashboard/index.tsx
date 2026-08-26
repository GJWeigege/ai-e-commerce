import { PageContainer, ProCard, StatisticCard } from '@ant-design/pro-components';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth';
import { fetchDashboardStats } from '../../services/order';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Awaited<ReturnType<typeof fetchDashboardStats>> | null>(null);

  useEffect(() => {
    fetchDashboardStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  return (
    <PageContainer title="工作台">
      <ProCard direction="column" ghost gutter={[16, 16]}>
        <StatisticCard.Group>
          <StatisticCard statistic={{ title: '当前用户', value: user?.realName || user?.username || '-' }} />
          <StatisticCard statistic={{ title: '采集任务', value: stats?.tasks ?? 0 }} />
          <StatisticCard statistic={{ title: '待复审', value: stats?.pendingReview ?? 0 }} />
          <StatisticCard statistic={{ title: '已上架', value: stats?.onShelf ?? 0 }} />
          <StatisticCard statistic={{ title: '销售单', value: stats?.sales ?? 0 }} />
          <StatisticCard statistic={{ title: '未处理告警', value: stats?.openAlerts ?? 0 }} />
        </StatisticCard.Group>
        <ProCard title="一期链路">
          Ozon 采集 → AI 选品复审 → 选择店铺上架到 Wildberries → 销售单/代采单 → WB 中转 → 代发仓入出库。采集与上架均为真实接口；店铺 Token 在「店铺管理」中按租户保存，不再写入环境变量。
        </ProCard>
      </ProCard>
    </PageContainer>
  );
}
