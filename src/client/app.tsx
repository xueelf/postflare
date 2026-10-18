import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';

import { Button } from './components/button';
import { ConfirmDialog } from './components/confirm-dialog';
import { Notice } from './components/notice';
import { displayName } from './format';
import { useAuth } from './hooks/use-auth';
import { useCompose } from './hooks/use-compose';
import { useConfirm } from './hooks/use-confirm';
import { useMessages } from './hooks/use-messages';
import { useShell } from './hooks/use-shell';
import { useTabFields } from './hooks/use-tab-fields';
import { useTemplates } from './hooks/use-templates';
import { useTheme } from './hooks/use-theme';
import { initialLocale, LocaleProvider, matchLocale, useI18n } from './i18n';
import { Layout } from './layout';
import {
  type View,
  isSettingsDialog,
  isTemplateDialog,
  MAILBOX_VIEWS,
  parseRoute,
  viewPath,
} from './route';
import { Auth } from './views/auth';
import { Invite } from './views/auth/invite';
import { Compose } from './views/compose';
import { type MailProps, Mail } from './views/mail';
import { Settings } from './views/settings';
import { Templates } from './views/templates';
import { TemplateDialog } from './views/templates/dialog';
import { Users } from './views/users';

/**
 * 应用根组件：解析界面语言并提供给下层。
 */
export function App() {
  const navigate = useNavigate();
  const auth = useAuth(navigate);
  // 未登录时按浏览器语言，登录后以账号设置为准
  const locale = auth.auth?.user
    ? matchLocale(auth.auth.user.language)
    : initialLocale();

  return (
    <LocaleProvider locale={locale}>
      <AppShell auth={auth} />
    </LocaleProvider>
  );
}

/**
 * 应用主体：连接路由与各领域状态 Hook。
 */
function AppShell({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { view, messageId } = parseRoute(location.pathname);
  const settingsOpen = isSettingsDialog(location.hash);
  const q = new URLSearchParams(location.search).get('q') ?? '';
  const route = {
    view,
    q,
    messageId,
    compose: location.hash === '#compose',
    template: isTemplateDialog(location.hash),
    path: location.pathname + location.search,
  };

  const confirm = useConfirm();
  const shell = useShell();
  const ready = !!auth.auth?.user;
  const messages = useMessages(route, navigate, ready, confirm.askConfirm);
  const compose = useCompose(route, {
    navigate,
    closeDrawer: shell.closeDrawer,
    openMessage: messages.openMessage,
    refreshList: messages.refreshList,
  });
  const templates = useTemplates(route, ready, {
    navigate,
    closeDrawer: shell.closeDrawer,
    askConfirm: confirm.askConfirm,
  });
  const { theme, setTheme } = useTheme();

  useTabFields();

  if (!auth.auth) {
    return (
      <div className="auth-wrap">
        <div className="auth-stage">
          {auth.authError ? (
            <>
              <Notice role="alert">
                <strong>{t('app.connectFailed')}</strong>
                <span>{t('app.connectFailedHint')}</span>
              </Notice>
              <Button
                variant="primary"
                className="auth-submit"
                onClick={auth.reloadAuth}
              >
                {t('common.retry')}
              </Button>
            </>
          ) : (
            <p className="meta">{t('common.loading')}</p>
          )}
        </div>
      </div>
    );
  }

  // 一次性链接：登录与否都可以打开，设置密码后自动登录
  if (location.pathname.startsWith('/invite/')) {
    return (
      <Invite
        token={location.pathname.slice('/invite/'.length)}
        busy={auth.authBusy}
        onSubmit={auth.completeInvite}
      />
    );
  }

  if (!auth.auth.user) {
    const setup = !auth.auth.setupComplete;
    const authView = (
      <Auth
        setupComplete={auth.auth.setupComplete}
        mailDomain={auth.auth.mailDomain}
        domain={auth.domain}
        domainError={auth.domainError}
        busy={auth.authBusy}
        onSubmit={auth.submitAuth}
      />
    );

    return (
      <Routes>
        <Route
          path="/"
          element={setup ? authView : <Navigate to="/login" replace />}
        />
        <Route
          path="/login"
          element={setup ? <Navigate to="/" replace /> : authView}
        />
        <Route
          path="*"
          element={<Navigate to={setup ? '/' : '/login'} replace />}
        />
      </Routes>
    );
  }

  const user = auth.auth.user;
  const accountName = displayName(user);
  const openMenu = () => shell.setDrawerOpen(true);
  const readerOpen = messageId !== null;

  const emptyText = t(
    view === 'spam'
      ? 'app.emptySpam'
      : view === 'trash'
        ? 'app.emptyTrash'
        : view === 'drafts'
          ? 'app.emptyDrafts'
          : 'app.emptySearch',
  );

  // 关闭阅读器与弹窗：打开时压过历史栈的回退，直接刷新进来的用 replace
  const closeOverlay = (flag: string, fallback: string) => {
    if (location.state?.[flag]) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  };

  const closeReader = () => closeOverlay('pfOpen', viewPath(view, null, q));

  const closeCompose = () => {
    compose.resetCompose();
    closeOverlay('pfCompose', viewPath(view, messageId, q));
  };

  const closeTemplate = () =>
    closeOverlay('pfTemplate', location.pathname + location.search);

  // 设置弹窗由片段驱动，弹窗内部的层级留在组件里，不进地址
  const closeSettings = () =>
    closeOverlay('pfSettings', location.pathname + location.search);

  const openSettings = () => {
    shell.closeDrawer();

    navigate(`${location.pathname}${location.search}#settings`, {
      state: { pfSettings: true },
    });
  };

  // 包装一层：按钮点击会把事件对象当参数传入，openTemplate 只接受模板 id
  const createTemplate = () => templates.openTemplate();

  const logout = () => {
    auth.logout();
    shell.closeDrawer();
  };

  const mailProps: Omit<MailProps, 'view'> = {
    messages: messages.messages,
    search: messages.search,
    onSearch: messages.setSearch,
    onOpen: message => {
      navigate(viewPath(view, message.id, q), { state: { pfOpen: true } });
    },
    emptyText,
    openId: messageId,
    collapsed: shell.sidebarCollapsed,
    onToggleSidebar: shell.toggleSidebar,
    onMenu: openMenu,
    user,
    onCreateTemplate: createTemplate,
    onLogout: logout,
    message: messages.openMessage,
    accountName,
    accountEmail: user.email,
    onBack: closeReader,
    onCompose: () => {
      const message = messages.openMessage;
      const to =
        message && message.direction === 'inbound'
          ? message.from_address
          : (message?.to_address ?? '');

      compose.openCompose(view === 'drafts' ? '' : to);
    },
    onDiscard: () => {
      if (messageId) {
        messages.discardDraft(messageId);
      }
    },
    onMove: mailbox => {
      if (messageId) {
        messages.moveMessage(messageId, mailbox);
      }
    },
    onPurge: () => {
      if (messageId) {
        messages.purgeMessage(messageId);
      }
    },
  };

  const panel = (
    <Routes>
      <Route path="/" element={<Navigate to="/inbox" replace />} />
      <Route path="/login" element={<Navigate to="/inbox" replace />} />
      <Route
        path="/templates/:id?"
        element={
          <Templates
            templates={templates.templates}
            openId={messageId}
            search={messages.search}
            onSearch={messages.setSearch}
            onSelect={id =>
              navigate(viewPath('templates', id, q), {
                state: { pfOpen: true },
              })
            }
            onEdit={templates.openTemplate}
            onDelete={templates.removeTemplate}
            onBack={closeReader}
            collapsed={shell.sidebarCollapsed}
            onToggleSidebar={shell.toggleSidebar}
            user={user}
            onCreateTemplate={createTemplate}
            onLogout={logout}
            onMenu={openMenu}
          />
        }
      />
      <Route path="/:mailbox" element={<MailboxRoute mail={mailProps} />} />
      <Route path="/:mailbox/:id" element={<MailboxRoute mail={mailProps} />} />
      <Route
        path="/users"
        element={
          user.role === 'owner' ? (
            <Users
              mailDomain={auth.auth.mailDomain}
              askConfirm={confirm.askConfirm}
            />
          ) : (
            <Navigate to="/inbox" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );

  return (
    <Layout
      collapsed={shell.sidebarCollapsed}
      drawerOpen={shell.drawerOpen}
      onDrawerClose={shell.closeDrawer}
      readerOpen={readerOpen}
      user={user}
      view={view}
      counts={messages.counts}
      settingsOpen={settingsOpen}
      onNavigate={next => {
        shell.closeDrawer();
        navigate(`/${next}`);
      }}
      onCompose={() => compose.openCompose()}
      onCreateTemplate={createTemplate}
      onOpenSettings={openSettings}
      onLogout={logout}
    >
      {panel}
      {compose.composing && (
        <Compose
          title={t(
            view === 'drafts' && messageId ? 'app.editDraft' : 'app.newMessage',
          )}
          to={compose.composeTo}
          subject={compose.composeSubject}
          text={compose.composeText}
          html={compose.composeHtml}
          busy={compose.composeBusy}
          status={compose.composeStatus}
          onToChange={compose.setComposeTo}
          onSubjectChange={compose.setComposeSubject}
          onHtmlChange={(html, text) => {
            compose.setComposeHtml(html);
            compose.setComposeText(text);
          }}
          onUploadImage={compose.uploadImage}
          onSend={compose.sendCompose}
          onDismiss={() => {
            compose.flushDraft();
            closeCompose();
          }}
        />
      )}
      {templates.editing && (
        <TemplateDialog
          draft={templates.editing}
          saving={templates.saving}
          onChange={templates.setEditing}
          onSave={templates.saveTemplate}
          onImportFile={templates.importTemplateFile}
          onDismiss={closeTemplate}
        />
      )}
      {settingsOpen && (
        <Settings
          user={user}
          theme={theme}
          onTheme={setTheme}
          onClose={closeSettings}
          profileBusy={auth.profileBusy}
          passwordBusy={auth.passwordBusy}
          onSaveProfile={auth.updateProfile}
          onSavePassword={auth.changePassword}
        />
      )}
      {confirm.confirm && (
        <ConfirmDialog
          title={confirm.confirm.title}
          message={confirm.confirm.message}
          confirmText={confirm.confirm.confirmText}
          danger={confirm.confirm.danger}
          onConfirm={confirm.resolveConfirm}
          onCancel={confirm.cancelConfirm}
        />
      )}
    </Layout>
  );
}

/**
 * 文件夹路由：校验 mailbox 参数，无效时归一化回收件箱。
 */
function MailboxRoute({ mail }: { mail: Omit<MailProps, 'view'> }) {
  const { mailbox } = useParams();

  if (!mailbox || !MAILBOX_VIEWS.includes(mailbox as View)) {
    return <Navigate to="/inbox" replace />;
  }
  return <Mail {...mail} view={mailbox as View} />;
}
