import { LoginForm, ProFormText } from '@ant-design/pro-components';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f5f5f5' }}>
      <LoginForm
        title="跨境电商多租户系统"
        subTitle="Ozon 选品 · 代采 · WB 中转 · 俄罗斯代发"
        onFinish={async (values) => {
          try {
            await login(values.username, values.password);
            message.success('登录成功');
            navigate('/dashboard');
          } catch (error) {
            message.error(error instanceof Error ? error.message : '登录失败');
            return false;
          }
          return true;
        }}
      >
        <ProFormText
          name="username"
          fieldProps={{ size: 'large', prefix: <UserOutlined /> }}
          placeholder="用户名"
          rules={[{ required: true, message: '请输入用户名' }]}
        />
        <ProFormText.Password
          name="password"
          fieldProps={{ size: 'large', prefix: <LockOutlined /> }}
          placeholder="密码"
          rules={[{ required: true, message: '请输入密码' }]}
        />
      </LoginForm>
    </div>
  );
}
