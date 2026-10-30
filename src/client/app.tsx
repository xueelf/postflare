import { useEffect, useRef, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';

import { apiFetch } from './api';
import { Button } from './components/button';
import { ConfirmDialog } from './components/confirm-dialog';
import { Modal } from './components/modal';
import { Notice } from './components/notice';
import { displayName } from './format';
import { useAuth } from './hooks/use-auth';
import { useComposeWindows } from './hooks/use-compose-windows';
import { useConfirm } from './hooks/use-confirm';
import { useMessages } from './hooks/use-messages';
import { useShell } from './hooks/use-shell';
import { useTemplates } from './hooks/use-templates';
import { useTheme } from './hooks/use-theme';
import { initialLocale, LocaleProvider, matchLocale, useI18n } from './i18n';
import { Layout } from './layout';
import { draftLockName, templateLockName, withAvailableLock } from './locks';
import {
  type View,
  isSettingsDialog,
  MAILBOX_VIEWS,
  parseRoute,
  viewPath,
} from './route';
import { Auth } from './views/auth';
import { Invite } from './views/auth/invite';
import { ComposeWindow } from './views/compose/window';
import { type MailProps, Mail } from './views/mail';
import { Settings } from './views/settings';
import { Templates } from './views/templates';
import { TemplateWindow } from './views/templates/window';
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
      <AppShell key={auth.auth?.user?.id ?? 'anonymous'} auth={auth} />
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
    hash: location.hash,
    state: location.state,
    path: location.pathname + location.search,
  };
  const routeRef = useRef({ view, q, messageId });

  routeRef.current = { view, q, messageId };

  const confirm = useConfirm();
  const shell = useShell();
  const ready = !!auth.auth?.user;
  const userId = auth.auth?.user?.id ?? '';
  const messages = useMessages(route, navigate, ready, confirm.askConfirm, id =>
    withAvailableLock(draftLockName(userId, id), () =>
      apiFetch(`/api/drafts/${id}`, { method: 'DELETE' }),
    ),
  );
  const composeWindows = useComposeWindows();

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (composeWindows.windows.some(window => window.dirty)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);

    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [composeWindows.windows]);

  const templates = useTemplates(route, ready, {
    navigate,
    closeDrawer: shell.closeDrawer,
    askConfirm: confirm.askConfirm,
    deleteTemplate: id =>
      withAvailableLock(templateLockName(userId, id), () =>
        apiFetch(`/api/templates/${id}`, { method: 'DELETE' }),
      ),
  });
  const { theme, setTheme } = useTheme();
  const [logoutPrompt, setLogoutPrompt] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const logoutBlocked = logoutBusy || auth.logoutBusy;

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
        busy={auth.authBusy || auth.logoutBusy}
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
        busy={auth.authBusy || auth.logoutBusy}
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

  // 关闭阅读器与弹窗：应用内打开的按历史回退，直接刷新进入的用 replace 跳转
  const closeOverlay = (flag: string, fallback: string) => {
    if (location.state?.[flag]) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  };

  const closeReader = () => closeOverlay('pfOpen', viewPath(view, null, q));

  // 设置弹窗由片段驱动，弹窗内部的层级留在组件里，不进地址
  const closeSettings = () =>
    closeOverlay('pfSettings', location.pathname + location.search);

  const openSettings = () => {
    shell.closeDrawer();

    navigate(`${location.pathname}${location.search}#settings`, {
      state: { pfSettings: true },
    });
  };

  const logout = () => {
    if (composeWindows.windows.some(window => window.dirty)) {
      setLogoutError('');
      setLogoutPrompt(true);

      return;
    }

    if (auth.logoutBusy) {
      return;
    }
    auth.logout();
    shell.closeDrawer();
  };

  const mailProps: Omit<MailProps, 'view'> = {
    messages: messages.messages,
    nextCursor: messages.nextCursor,
    loadingMore: messages.loadingMore,
    onLoadMore: messages.loadMore,
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
    onImportEmail: messages.importMessages,
    onImportTemplate: templates.importTemplates,
    onLogout: logout,
    message: messages.openMessage,
    loading: messages.messageLoading,
    accountName,
    accountEmail: user.email,
    onBack: closeReader,
    onCompose: () => {
      if (view === 'drafts' && messageId) {
        composeWindows.openDraft(messageId);

        return;
      }
      const message = messages.openMessage;
      const to =
        message && message.direction === 'inbound'
          ? message.from_address
          : (message?.to_address ?? '');

      composeWindows.openNew(to);
    },
    onDiscard: () => {
      const message = messages.openMessage;

      if (message) {
        messages.discardDraft(message.id);
      }
    },
    onDownload: () => {
      const message = messages.openMessage;

      if (message) {
        messages.downloadMessage(message.id);
      }
    },
    onSaveTemplate: () => {
      if (messages.openMessage) {
        templates.saveMessageAsTemplate(messages.openMessage);
      }
    },
    onMove: mailbox => {
      const message = messages.openMessage;

      if (message) {
        messages.moveMessage(message.id, mailbox);
      }
    },
    onPurge: () => {
      const message = messages.openMessage;

      if (message) {
        messages.purgeMessage(message.id);
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
            onEdit={id => composeWindows.openTemplate(id)}
            onDelete={templates.removeTemplate}
            onBack={closeReader}
            collapsed={shell.sidebarCollapsed}
            onToggleSidebar={shell.toggleSidebar}
            user={user}
            onImportEmail={messages.importMessages}
            onImportTemplate={templates.importTemplates}
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
              askConfirm={confirm.askConfirm}
              collapsed={shell.sidebarCollapsed}
              onToggleSidebar={shell.toggleSidebar}
              onMenu={openMenu}
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
      onCompose={() => {
        shell.closeDrawer();
        composeWindows.openNew();
      }}
      onImportEmail={messages.importMessages}
      onImportTemplate={templates.importTemplates}
      onOpenSettings={openSettings}
      onLogout={logout}
    >
      {panel}
      {composeWindows.windows.map(info => {
        const minimized = composeWindows.windows.filter(
          window => window.minimized,
        );

        if (info.kind === 'template') {
          return (
            <TemplateWindow
              key={info.id}
              info={info}
              template={
                templates.templates.find(
                  template => template.id === info.templateId,
                ) ?? null
              }
              fullscreen={info.fullscreen}
              dockIndex={minimized.findIndex(window => window.id === info.id)}
              userId={user.id}
              onClose={composeWindows.closeWindow}
              onMinimize={composeWindows.minimize}
              onRestore={composeWindows.restoreWindow}
              onToggleFullscreen={composeWindows.toggleFullscreen}
              onFocus={composeWindows.focusWindow}
              onMove={composeWindows.moveWindow}
              onRegisterSave={composeWindows.registerSave}
              onUnregisterSave={composeWindows.unregisterSave}
              onDirtyChange={composeWindows.setWindowDirty}
              onCreated={id => navigate(`/templates/${id}`, { replace: true })}
              onDeleted={() => {
                const current = routeRef.current;

                if (
                  current.view === 'templates' &&
                  (current.messageId === null ||
                    current.messageId === info.templateId)
                ) {
                  navigate(viewPath('templates', null, current.q), {
                    replace: true,
                  });
                }
              }}
              askConfirm={confirm.askConfirm}
              refreshTemplates={templates.refreshTemplates}
            />
          );
        }

        return (
          <ComposeWindow
            key={info.id}
            info={info}
            fullscreen={info.fullscreen}
            dockIndex={minimized.findIndex(window => window.id === info.id)}
            userId={user.id}
            askConfirm={confirm.askConfirm}
            onDraftId={composeWindows.registerDraftId}
            onClose={composeWindows.closeWindow}
            onMinimize={composeWindows.minimize}
            onRestore={composeWindows.restoreWindow}
            onToggleFullscreen={composeWindows.toggleFullscreen}
            onFocus={composeWindows.focusWindow}
            onMove={composeWindows.moveWindow}
            onRegisterSave={composeWindows.registerSave}
            onUnregisterSave={composeWindows.unregisterSave}
            onDirtyChange={composeWindows.setWindowDirty}
            refreshList={messages.refreshList}
            refreshCounts={messages.refreshCounts}
            syncOpenMessage={messages.syncOpenMessage}
          />
        );
      })}
      {logoutPrompt && (
        <Modal
          title={auth.logoutBusy ? t('app.signingOut') : t('app.unsavedTitle')}
          onDismiss={logoutBlocked ? undefined : () => setLogoutPrompt(false)}
          footer={
            auth.logoutBusy ? null : (
              <>
                <Button
                  disabled={logoutBusy}
                  onClick={() => setLogoutPrompt(false)}
                >
                  {t('ui.cancel')}
                </Button>
                <Button
                  disabled={logoutBusy}
                  variant="danger"
                  onClick={() => {
                    if (logoutBlocked) {
                      return;
                    }
                    setLogoutBusy(true);
                    setLogoutError('');

                    auth
                      .logout()
                      .then(ok => {
                        setLogoutBusy(false);

                        if (!ok) {
                          setLogoutError(t('app.logoutFailed'));

                          return;
                        }
                        setLogoutPrompt(false);
                        shell.closeDrawer();
                      })
                      .catch(() => {
                        setLogoutBusy(false);
                        setLogoutError(t('app.logoutFailed'));
                      });
                  }}
                >
                  {t('app.discardAndLogout')}
                </Button>
                <Button
                  variant="primary"
                  disabled={logoutBusy}
                  onClick={() => {
                    if (logoutBlocked) {
                      return;
                    }
                    setLogoutBusy(true);
                    setLogoutError('');

                    composeWindows
                      .saveAll()
                      .then(async saved => {
                        if (!saved) {
                          setLogoutBusy(false);
                          setLogoutError(t('compose.saveFailed'));

                          return;
                        }
                        const ok = await auth.logout();

                        setLogoutBusy(false);

                        if (!ok) {
                          setLogoutError(t('app.logoutFailed'));

                          return;
                        }
                        setLogoutPrompt(false);
                        shell.closeDrawer();
                      })
                      .catch(() => {
                        setLogoutBusy(false);
                        setLogoutError(t('compose.saveFailed'));
                      });
                  }}
                >
                  {logoutBusy ? t('compose.saving') : t('app.saveAndLogout')}
                </Button>
              </>
            )
          }
        >
          {auth.logoutBusy ? (
            <p>{t('app.signingOutHint')}</p>
          ) : (
            <p>{t('app.unsavedBody')}</p>
          )}
          {logoutError && <p role="alert">{logoutError}</p>}
        </Modal>
      )}
      {auth.logoutBusy && !logoutPrompt && (
        <Modal title={t('app.signingOut')} size="sm">
          <p>{t('app.signingOutHint')}</p>
        </Modal>
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
 * 文件夹路由：校验 mailbox 参数，无效时回落到收件箱。
 */
function MailboxRoute({ mail }: { mail: Omit<MailProps, 'view'> }) {
  const { mailbox } = useParams();

  if (!mailbox || !MAILBOX_VIEWS.includes(mailbox as View)) {
    return <Navigate to="/inbox" replace />;
  }
  return <Mail {...mail} view={mailbox as View} />;
}
