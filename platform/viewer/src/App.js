import React, { Component } from 'react';
import { OidcProvider } from 'redux-oidc';
import { I18nextProvider } from 'react-i18next';
import PropTypes from 'prop-types';
import { Provider } from 'react-redux';
import { BrowserRouter as Router } from 'react-router-dom';
import OHIFCornerstoneExtension from '@ohif/extension-cornerstone';
import { hot } from 'react-hot-loader/root';

import {
  SnackbarProvider,
  ModalProvider,
  DialogProvider,
  OHIFModal,
} from '@ohif/ui';

import {
  CommandsManager,
  ExtensionManager,
  ServicesManager,
  HotkeysManager,
  createUINotificationService,
  createUIModalService,
  createUIDialogService,
  utils,
  redux as reduxOHIF
} from '@ohif/core';

import i18n from '@ohif/i18n';

// TODO: This should not be here
import './config';

/** Utils */
import {
  getUserManagerForOpenIdConnectClient,
  initWebWorkers,
} from './utils/index.js';

/** Extensions */
import { GenericViewerCommands, MeasurementsPanel } from './appExtensions';

/** Viewer */
import OHIFStandaloneViewer from './OHIFStandaloneViewer';

/** Store */
import { getActiveContexts } from './store/layout/selectors.js';
import store from './store';
const { setUserPreferences } = reduxOHIF.actions;

/** Contexts */
import WhiteLabellingContext from './context/WhiteLabellingContext';
import UserManagerContext from './context/UserManagerContext';
import AppContext from './context/AppContext';

/** ~~~~~~~~~~~~~ Application Setup */
const commandsManagerConfig = {
  getAppState: () => store.getState(),
  getActiveContexts: () => getActiveContexts(store.getState()),
};

/** Services */
const UINotificationService = createUINotificationService();
const UIModalService = createUIModalService();
const UIDialogService = createUIDialogService();

/** Managers */
const commandsManager = new CommandsManager(commandsManagerConfig);
const hotkeysManager = new HotkeysManager(commandsManager);
const servicesManager = new ServicesManager();
const extensionManager = new ExtensionManager({
  commandsManager,
  servicesManager,
});
/** ~~~~~~~~~~~~~ End Application Setup */

// TODO[react] Use a provider when the whole tree is React
window.store = store;

class App extends Component {
  static propTypes = {
    routerBasename: PropTypes.string.isRequired,
    servers: PropTypes.object.isRequired,
    //
    oidc: PropTypes.array,
    whiteLabelling: PropTypes.object,
    extensions: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string.isRequired,
      })
    ),
    hotkeys: PropTypes.array,
  };

  static defaultProps = {
    whiteLabelling: {},
    oidc: [],
    extensions: [],
  };

  _appConfig;
  _userManager;

  constructor(props) {
    super(props);

    this._appConfig = props;

    const { servers, extensions, hotkeys, oidc } = props;

    this.initUserManager(oidc);
    _initServices([UINotificationService, UIModalService, UIDialogService]);
    _initExtensions(extensions, hotkeys);
    _initServers(servers);
    initWebWorkers();
  }

  render() {
    const { whiteLabelling, routerBasename } = this.props;
    const userManager = this._userManager;
    const config = {
      appConfig: this._appConfig,
    };

    if (userManager) {
      return (
        <AppContext.Provider value={config}>
          <Provider store={store}>
            <I18nextProvider i18n={i18n}>
              <OidcProvider store={store} userManager={userManager}>
                <UserManagerContext.Provider value={userManager}>
                  <Router basename={routerBasename}>
                    <WhiteLabellingContext.Provider value={whiteLabelling}>
                      <SnackbarProvider service={UINotificationService}>
                        <DialogProvider service={UIDialogService}>
                          <ModalProvider
                            modal={OHIFModal}
                            service={UIModalService}
                          >
                            <OHIFStandaloneViewer userManager={userManager} />
                          </ModalProvider>
                        </DialogProvider>
                      </SnackbarProvider>
                    </WhiteLabellingContext.Provider>
                  </Router>
                </UserManagerContext.Provider>
              </OidcProvider>
            </I18nextProvider>
          </Provider>
        </AppContext.Provider>
      );
    }

    return (
      <AppContext.Provider value={config}>
        <Provider store={store}>
          <I18nextProvider i18n={i18n}>
            <Router basename={routerBasename}>
              <WhiteLabellingContext.Provider value={whiteLabelling}>
                <SnackbarProvider service={UINotificationService}>
                  <DialogProvider service={UIDialogService}>
                    <ModalProvider modal={OHIFModal} service={UIModalService}>
                      <OHIFStandaloneViewer />
                    </ModalProvider>
                  </DialogProvider>
                </SnackbarProvider>
              </WhiteLabellingContext.Provider>
            </Router>
          </I18nextProvider>
        </Provider>
      </AppContext.Provider>
    );
  }

  initUserManager(oidc) {
    if (oidc && !!oidc.length) {
      const firstOpenIdClient = this.props.oidc[0];

      const { protocol, host } = window.location;
      const { routerBasename } = this.props;
      const baseUri = `${protocol}//${host}${routerBasename}`;

      const redirect_uri = firstOpenIdClient.redirect_uri || '/callback';
      const silent_redirect_uri =
        firstOpenIdClient.silent_redirect_uri || '/silent-refresh.html';
      const post_logout_redirect_uri =
        firstOpenIdClient.post_logout_redirect_uri || '/';

      const openIdConnectConfiguration = Object.assign({}, firstOpenIdClient, {
        redirect_uri: _makeAbsoluteIfNecessary(redirect_uri, baseUri),
        silent_redirect_uri: _makeAbsoluteIfNecessary(
          silent_redirect_uri,
          baseUri
        ),
        post_logout_redirect_uri: _makeAbsoluteIfNecessary(
          post_logout_redirect_uri,
          baseUri
        ),
      });

      this._userManager = getUserManagerForOpenIdConnectClient(
        store,
        openIdConnectConfiguration
      );
    }
  }
}

function _initServices(services) {
  servicesManager.registerServices(services);
}

/**
 * @param
 */
function _initExtensions(extensions, hotkeys) {
  const defaultExtensions = [
    GenericViewerCommands,
    OHIFCornerstoneExtension,
    // WARNING: MUST BE REGISTERED _AFTER_ OHIFCORNERSTONEEXTENSION
    MeasurementsPanel,
  ];
  const mergedExtensions = defaultExtensions.concat(extensions);
  extensionManager.registerExtensions(mergedExtensions);

  const { hotkeyDefinitions = {} } = store.getState().preferences || {};
  let updateStore = false;
  let hotkeysToUse = hotkeyDefinitions;

  // Must run after extension commands are registered
  // if there is no hotkeys from localStorate set up from config
  if (!Object.keys(hotkeyDefinitions).length) {
    hotkeysToUse = hotkeys;
    updateStore = true;
  }

  if (hotkeysToUse) {
    hotkeysManager.setHotkeys(hotkeysToUse);
    // set default based on app config
    hotkeysManager.setDefaultHotKeys(hotkeys);

    if (updateStore) {
      const { hotkeyDefinitions } = hotkeysManager;
      const windowLevelData = {};
      store.dispatch(
        setUserPreferences({ windowLevelData, hotkeyDefinitions })
      );
    }
  }
}

function _initServers(servers) {
  if (servers) {
    utils.addServers(servers, store);
  }
}

function _isAbsoluteUrl(url) {
  return url.includes('http://') || url.includes('https://');
}

function _makeAbsoluteIfNecessary(url, base_url) {
  if (_isAbsoluteUrl(url)) {
    return url;
  }

  // Make sure base_url and url are not duplicating slashes
  if (base_url[base_url.length - 1] === '/') {
    base_url = base_url.slice(0, base_url.length - 1);
  }

  return base_url + url;
}

// Only wrap/use hot if in dev
const ExportedApp = process.env.NODE_ENV === 'development' ? hot(App) : App;

export default ExportedApp;
export { commandsManager, extensionManager, hotkeysManager, servicesManager };
