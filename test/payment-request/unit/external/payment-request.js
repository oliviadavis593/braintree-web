'use strict';

var analytics = require('../../../../src/lib/analytics');
var Bus = require('../../../../src/lib/bus');
var BraintreeError = require('../../../../src/lib/braintree-error');
var constants = require('../../../../src/lib/constants');
var methods = require('../../../../src/lib/methods');
var PaymentRequestComponent = require('../../../../src/payment-request/external/payment-request');
var fake = require('../../../helpers/fake');
var rejectIfResolves = require('../../../helpers/promise-helper').rejectIfResolves;
var VERSION = process.env.npm_package_version;

function stubPaymentRequestBusHandler() {
  setTimeout(function () {
    var paymentRequestReadyHandler = Bus.prototype.on.withArgs('payment-request:FRAME_CAN_MAKE_REQUESTS').args[0][1];

    paymentRequestReadyHandler();
  }, 100);
}

describe('Payment Request component', function () {
  beforeEach(function () {
    var configuration = fake.configuration();

    configuration.gatewayConfiguration.androidPay = {
      enabled: true,
      googleAuthorizationFingerprint: 'fingerprint',
      supportedNetworks: ['visa', 'amex']
    };

    this.fakeClient = fake.client({
      configuration: configuration
    });

    this.sandbox.stub(Bus.prototype, 'on');
    this.sandbox.stub(Bus.prototype, 'emit');
    this.sandbox.stub(analytics, 'sendEvent');
    this.instance = new PaymentRequestComponent({
      client: this.fakeClient
    });
    this.sandbox.stub(this.instance, '_emit');
    this.sandbox.stub(this.instance, 'on');
  });

  it('sets up a bus with a unique channel', function () {
    var instance1 = new PaymentRequestComponent({
      client: this.fakeClient
    });
    var instance2 = new PaymentRequestComponent({
      client: this.fakeClient
    });

    expect(instance1._bus.channel).to.not.equal(instance2._bus.channel);
  });

  it('sets default supported payment methods', function () {
    var instance = new PaymentRequestComponent({
      client: this.fakeClient
    });

    expect(instance._defaultSupportedPaymentMethods[0].supportedMethods).to.deep.equal('basic-card');
    expect(instance._defaultSupportedPaymentMethods[0].data).to.deep.equal({
      supportedNetworks: ['amex', 'discover', 'visa']
    });
    expect(instance._defaultSupportedPaymentMethods[1].supportedMethods).to.deep.equal('https://google.com/pay');
    expect(instance._defaultSupportedPaymentMethods[1].data).to.deep.equal({
      merchantId: '18278000977346790994',
      apiVersion: 1,
      environment: 'TEST',
      allowedPaymentMethods: ['CARD', 'TOKENIZED_CARD'],
      paymentMethodTokenizationParameters: {
        tokenizationType: 'PAYMENT_GATEWAY',
        parameters: {
          gateway: 'braintree',
          'braintree:merchantId': 'merchant-id',
          'braintree:authorizationFingerprint': 'fingerprint',
          'braintree:apiVersion': 'v1',
          'braintree:sdkVersion': constants.VERSION,
          'braintree:metadata': JSON.stringify({
            source: constants.SOURCE,
            integration: constants.INTEGRATION,
            sessionId: 'fakeSessionId',
            version: VERSION,
            platform: constants.PLATFORM
          })
        }
      },
      cardRequirements: {
        allowedCardNetworks: ['VISA', 'AMEX']
      }
    });
  });

  it('filters undefined values from supportedMethods', function () {
    var configuration = fake.configuration();
    var instance, fakeClient;

    configuration.gatewayConfiguration.creditCards.supportedCardTypes = [
      'American Express',
      'Discover',
      'Apple Pay - Visa',
      'Visa'
    ];
    fakeClient = fake.client({
      configuration: configuration
    });

    instance = new PaymentRequestComponent({
      client: fakeClient
    });

    expect(instance._defaultSupportedPaymentMethods[0].data.supportedNetworks).to.deep.equal(['amex', 'discover', 'visa']);
  });

  it('sets pay with google to have a clientKey param when using a tokenization key', function () {
    var instance;
    var conf = this.fakeClient.getConfiguration();

    conf.authorization = 'authorization';
    conf.authorizationType = 'TOKENIZATION_KEY';

    this.sandbox.stub(this.fakeClient, 'getConfiguration').returns(conf);

    instance = new PaymentRequestComponent({
      client: this.fakeClient
    });

    expect(instance._defaultSupportedPaymentMethods[1].data.paymentMethodTokenizationParameters.parameters['braintree:clientKey']).to.equal('authorization');
  });

  it('can turn off basic-card', function () {
    var instance = new PaymentRequestComponent({
      enabledPaymentMethods: {
        basicCard: false
      },
      client: this.fakeClient
    });

    expect(instance._defaultSupportedPaymentMethods.length).to.equal(1);
    expect(instance._defaultSupportedPaymentMethods[0].supportedMethods).to.deep.equal('https://google.com/pay');
  });

  it('can turn off pay with google', function () {
    var instance = new PaymentRequestComponent({
      enabledPaymentMethods: {
        googlePay: false
      },
      client: this.fakeClient
    });

    expect(instance._defaultSupportedPaymentMethods.length).to.equal(1);
    expect(instance._defaultSupportedPaymentMethods[0].supportedMethods).to.deep.equal('basic-card');
  });

  it('can use google pay v2 when requested', function () {
    var instance = new PaymentRequestComponent({
      googlePayVersion: 2,
      client: this.fakeClient
    });

    expect(instance._defaultSupportedPaymentMethods.length).to.equal(2);
    expect(instance._defaultSupportedPaymentMethods[1].supportedMethods).to.deep.equal('https://google.com/pay');
    expect(instance._defaultSupportedPaymentMethods[1].data).to.deep.equal({
      merchantInfo: {
        merchantId: '18278000977346790994'
      },
      apiVersion: 2,
      apiVersionMinor: 0,
      environment: 'TEST',
      allowedPaymentMethods: [{
        type: 'CARD',
        parameters: {
          allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
          allowedCardNetworks: ['VISA', 'AMEX']
        },
        tokenizationSpecification: {
          type: 'PAYMENT_GATEWAY',
          parameters: {
            gateway: 'braintree',
            'braintree:merchantId': 'merchant-id',
            'braintree:apiVersion': 'v1',
            'braintree:sdkVersion': VERSION,
            'braintree:metadata': JSON.stringify({
              source: constants.SOURCE,
              integration: constants.INTEGRATION,
              sessionId: 'fakeSessionId',
              version: VERSION,
              platform: constants.PLATFORM
            }),
            'braintree:authorizationFingerprint': 'fingerprint'
          }
        }
      }]
    });
  });

  it('can use paypal closed loop tokens via google pay v2 when authorized', function () {
    var client, instance;
    var configuration = fake.configuration();

    configuration.gatewayConfiguration.androidPay = {
      enabled: true,
      googleAuthorizationFingerprint: 'fingerprint',
      supportedNetworks: ['visa', 'amex']
    };
    configuration.gatewayConfiguration.paypalEnabled = true;
    configuration.gatewayConfiguration.paypal = {};
    configuration.gatewayConfiguration.androidPay.paypalClientId = 'paypal_client_id';
    configuration.gatewayConfiguration.paypal.environmentNoNetwork = false;

    client = fake.client({
      configuration: configuration
    });

    instance = new PaymentRequestComponent({
      googlePayVersion: 2,
      client: client
    });

    expect(instance._defaultSupportedPaymentMethods.length).to.equal(2);
    expect(instance._defaultSupportedPaymentMethods[1].supportedMethods).to.deep.equal('https://google.com/pay');
    expect(instance._defaultSupportedPaymentMethods[1].data).to.deep.equal({
      merchantInfo: {
        merchantId: '18278000977346790994'
      },
      apiVersion: 2,
      apiVersionMinor: 0,
      environment: 'TEST',
      allowedPaymentMethods: [{
        type: 'CARD',
        parameters: {
          allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
          allowedCardNetworks: ['VISA', 'AMEX']
        },
        tokenizationSpecification: {
          type: 'PAYMENT_GATEWAY',
          parameters: {
            gateway: 'braintree',
            'braintree:merchantId': 'merchant-id',
            'braintree:apiVersion': 'v1',
            'braintree:sdkVersion': VERSION,
            'braintree:metadata': JSON.stringify({
              source: constants.SOURCE,
              integration: constants.INTEGRATION,
              sessionId: 'fakeSessionId',
              version: VERSION,
              platform: constants.PLATFORM
            }),
            'braintree:authorizationFingerprint': 'fingerprint'
          }
        }
      }, {
        type: 'PAYPAL',
        parameters: {
          /* eslint-disable camelcase */
          purchase_context: {
            purchase_units: [{
              payee: {
                client_id: 'paypal_client_id'
              },
              recurring_payment: true
            }]
          }
          /* eslint-enable camelcase */
        },
        tokenizationSpecification: {
          type: 'PAYMENT_GATEWAY',
          parameters: {
            gateway: 'braintree',
            'braintree:merchantId': 'merchant-id',
            'braintree:apiVersion': 'v1',
            'braintree:sdkVersion': VERSION,
            'braintree:metadata': JSON.stringify({
              source: constants.SOURCE,
              integration: constants.INTEGRATION,
              sessionId: 'fakeSessionId',
              version: VERSION,
              platform: constants.PLATFORM
            }),
            'braintree:paypalClientId': 'paypal_client_id'
          }
        }
      }]
    });
  });

  describe('initialize', function () {
    beforeEach(function () {
      this.sandbox.stub(document.body, 'appendChild');
    });

    it('resolves with the instance', function (done) {
      this.instance.initialize().then(function (instance) {
        expect(instance).to.equal(this.instance);
        done();
      }.bind(this));

      setTimeout(function () {
        var paymentRequestReadyHandler = Bus.prototype.on.withArgs('payment-request:FRAME_CAN_MAKE_REQUESTS').args[0][1];

        expect(Bus.prototype.on).to.be.calledWith('payment-request:FRAME_CAN_MAKE_REQUESTS');

        paymentRequestReadyHandler();
      }, 100);
    });

    it('sends analytics event on initialization', function (done) {
      this.instance.initialize().then(function (instance) {
        expect(analytics.sendEvent).to.be.calledOnce;
        expect(analytics.sendEvent).to.be.calledWith(instance._client, 'payment-request.initialized');
        done();
      });

      setTimeout(function () {
        var paymentRequestReadyHandler = Bus.prototype.on.withArgs('payment-request:FRAME_CAN_MAKE_REQUESTS').args[0][1];

        expect(Bus.prototype.on).to.be.calledWith('payment-request:FRAME_CAN_MAKE_REQUESTS');

        paymentRequestReadyHandler();
      }, 100);
    });

    it('fails if there are no supported payment methods on merchant account', function () {
      this.instance._defaultSupportedPaymentMethods = [];

      return this.instance.initialize().then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.type).to.equal('MERCHANT');
        expect(err.code).to.equal('PAYMENT_REQUEST_NO_VALID_SUPPORTED_PAYMENT_METHODS');
        expect(err.message).to.equal('There are no supported payment methods associated with this account.');
      });
    });

    it('adds an iframe to the page', function (done) {
      this.instance.initialize().then(function () {
        var iframe = document.body.appendChild.args[0][0];

        expect(document.body.appendChild).to.be.calledOnce;
        expect(iframe.getAttribute('src')).to.match(/html\/payment-request-frame\.min\.html#.*/);
        expect(iframe.getAttribute('allowPaymentRequest')).to.exist;

        done();
      });

      stubPaymentRequestBusHandler();
    });

    it('uses unminified html page when client is set to debug mode', function (done) {
      this.sandbox.stub(this.fakeClient, 'getConfiguration').returns({
        gatewayConfiguration: {},
        isDebug: true
      });

      this.instance.initialize().then(function () {
        var iframe = document.body.appendChild.args[0][0];

        expect(document.body.appendChild).to.be.calledOnce;
        expect(iframe.getAttribute('src')).to.match(/payment-request-frame\.html#.*/);

        done();
      });

      stubPaymentRequestBusHandler();
    });

    it('sends client to iframe when it is ready', function (done) {
      var fakeClient = this.fakeClient;

      this.instance.initialize();

      setTimeout(function () {
        var frameReadyHandler = Bus.prototype.on.withArgs('payment-request:FRAME_READY').args[0][1];

        expect(Bus.prototype.on).to.be.calledWith('payment-request:FRAME_READY');

        frameReadyHandler(function (client) {
          expect(client).to.equal(fakeClient);
          done();
        });
      }, 100);
    });

    it('emits events for shipping address change', function (done) {
      var shippingAddress = {foo: 'bar'};

      Bus.prototype.on.withArgs('payment-request:SHIPPING_ADDRESS_CHANGE').yields(shippingAddress);
      Bus.prototype.on.withArgs('payment-request:FRAME_CAN_MAKE_REQUESTS').yields();
      this.instance.initialize();

      setTimeout(function () {
        expect(Bus.prototype.on).to.be.calledWith('payment-request:SHIPPING_ADDRESS_CHANGE');
        expect(this.instance._emit).to.be.calledWith('shippingAddressChange', {
          target: {
            shippingAddress: shippingAddress
          },
          updateWith: this.sandbox.match.func
        });
        expect(this.instance._emit).to.be.calledWith('shippingaddresschange', {
          target: {
            shippingAddress: shippingAddress
          },
          updateWith: this.sandbox.match.func
        });

        done();
      }.bind(this), 100);
    });

    it('emits events for shipping option change', function (done) {
      Bus.prototype.on.withArgs('payment-request:SHIPPING_OPTION_CHANGE').yields('option');
      Bus.prototype.on.withArgs('payment-request:FRAME_CAN_MAKE_REQUESTS').yields();
      this.instance.initialize();

      setTimeout(function () {
        expect(Bus.prototype.on).to.be.calledWith('payment-request:SHIPPING_OPTION_CHANGE');
        expect(this.instance._emit).to.be.calledWith('shippingOptionChange', {
          target: {
            shippingOption: 'option'
          },
          updateWith: this.sandbox.match.func
        });
        expect(this.instance._emit).to.be.calledWith('shippingoptionchange', {
          target: {
            shippingOption: 'option'
          },
          updateWith: this.sandbox.match.func
        });

        done();
      }.bind(this), 100);
    });
  });

  describe('tokenize', function () {
    beforeEach(function () {
      this.configuration = {
        supportedPaymentMethods: [{
          supportedMethods: 'basic-card',
          data: {
            supportedNetworks: ['amex', 'visa']
          }
        }],
        details: {
          total: '100.00'
        },
        options: {}
      };

      Bus.prototype.emit.withArgs('payment-request:PAYMENT_REQUEST_INITIALIZED').yieldsAsync([null, {
        nonce: 'a-nonce',
        details: {
          rawPaymentResponse: {}
        }
      }]);
    });

    it('uses default supportedPaymentMethods if no supportedPaymentMethods are passed in', function () {
      delete this.configuration.supportedPaymentMethods;

      return this.instance.tokenize(this.configuration).then(function () {
        expect(Bus.prototype.emit).to.have.been.calledWith('payment-request:PAYMENT_REQUEST_INITIALIZED', {
          supportedPaymentMethods: this.instance._defaultSupportedPaymentMethods,
          details: this.configuration.details,
          options: this.configuration.options
        });
      }.bind(this));
    });

    it('emits PAYMENT_REQUEST_INITIALIZED', function () {
      return this.instance.tokenize(this.configuration).then(function () {
        expect(Bus.prototype.emit).to.have.been.calledWith('payment-request:PAYMENT_REQUEST_INITIALIZED', {
          supportedPaymentMethods: this.configuration.supportedPaymentMethods,
          details: this.configuration.details,
          options: this.configuration.options
        });
      }.bind(this));
    });

    it('sends analytics event on success', function () {
      return this.instance.tokenize(this.configuration).then(function () {
        expect(analytics.sendEvent).to.be.calledOnce;
        expect(analytics.sendEvent).to.be.calledWith(this.instance._client, 'payment-request.tokenize.succeeded');
      }.bind(this));
    });

    it('resolves with payload on success', function () {
      return this.instance.tokenize(this.configuration).then(function (payload) {
        expect(payload.nonce).to.equal('a-nonce');
      });
    });

    it('rejects with error on failure', function () {
      Bus.prototype.emit.withArgs('payment-request:PAYMENT_REQUEST_INITIALIZED').yieldsAsync([{
        code: 'A_BT_ERROR',
        type: 'MERCHANT',
        message: 'some error'
      }]);

      return this.instance.tokenize(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.type).to.equal('MERCHANT');
        expect(err.code).to.equal('PAYMENT_REQUEST_NOT_COMPLETED');
        expect(err.message).to.equal('Payment request could not be completed.');
        expect(err.details.originalError).to.deep.equal({
          code: 'A_BT_ERROR',
          type: 'MERCHANT',
          message: 'some error'
        });
      });
    });

    it('sends analytics event on failure', function () {
      Bus.prototype.emit.withArgs('payment-request:PAYMENT_REQUEST_INITIALIZED').yieldsAsync([{
        code: 'A_BT_ERROR',
        type: 'MERCHANT',
        message: 'some error'
      }]);

      return this.instance.tokenize(this.configuration).then(rejectIfResolves).catch(function () {
        expect(analytics.sendEvent).to.be.calledOnce;
        expect(analytics.sendEvent).to.be.calledWith(this.instance._client, 'payment-request.tokenize.failed');
      }.bind(this));
    });

    it('sends analytics event on payment request canceled', function () {
      Bus.prototype.emit.withArgs('payment-request:PAYMENT_REQUEST_INITIALIZED').yieldsAsync([{
        name: 'AbortError'
      }]);

      return this.instance.tokenize(this.configuration).then(rejectIfResolves).catch(function () {
        expect(analytics.sendEvent).to.be.calledOnce;
        expect(analytics.sendEvent).to.be.calledWith(this.instance._client, 'payment-request.tokenize.canceled');
      }.bind(this));
    });

    it('emits BraintreeError with type customer when customer cancels the payment request', function () {
      Bus.prototype.emit.withArgs('payment-request:PAYMENT_REQUEST_INITIALIZED').yieldsAsync([{
        name: 'AbortError'
      }]);

      return this.instance.tokenize(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.type).to.equal('CUSTOMER');
        expect(err.code).to.equal('PAYMENT_REQUEST_CANCELED');
        expect(err.message).to.equal('Payment request was canceled.');
        expect(err.details.originalError).to.deep.equal({
          name: 'AbortError'
        });
      });
    });

    it('emits BraintreeError with type merchant when merchant misconfigures payment request', function () {
      Bus.prototype.emit.withArgs('payment-request:PAYMENT_REQUEST_INITIALIZED').yieldsAsync([{
        name: 'PAYMENT_REQUEST_INITIALIZATION_FAILED'
      }]);

      return this.instance.tokenize(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.type).to.equal('MERCHANT');
        expect(err.code).to.equal('PAYMENT_REQUEST_INITIALIZATION_MISCONFIGURED');
        expect(err.message).to.equal('Something went wrong when configuring the payment request.');
        expect(err.details.originalError).to.deep.equal({
          name: 'PAYMENT_REQUEST_INITIALIZATION_FAILED'
        });
      });
    });

    it('emits BraintreeError with type merchant when emitted error is BRAINTREE_GATEWAY_GOOGLE_PAYMENT_TOKENIZATION_ERROR', function () {
      Bus.prototype.emit.withArgs('payment-request:PAYMENT_REQUEST_INITIALIZED').yieldsAsync([{
        name: 'BRAINTREE_GATEWAY_GOOGLE_PAYMENT_TOKENIZATION_ERROR',
        error: {message: 'some-error'}
      }]);

      return this.instance.tokenize(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.type).to.equal('MERCHANT');
        expect(err.code).to.equal('PAYMENT_REQUEST_GOOGLE_PAYMENT_FAILED_TO_TOKENIZE');
        expect(err.message).to.equal('Something went wrong when tokenizing the Google Pay card.');
        expect(err.details.originalError).to.deep.equal({
          name: 'BRAINTREE_GATEWAY_GOOGLE_PAYMENT_TOKENIZATION_ERROR',
          error: {message: 'some-error'}
        });
      });
    });

    it('emits BraintreeError with type unknown when emitted error is BRAINTREE_GATEWAY_GOOGLE_PAYMENT_PARSING_ERROR', function () {
      Bus.prototype.emit.withArgs('payment-request:PAYMENT_REQUEST_INITIALIZED').yieldsAsync([{
        name: 'BRAINTREE_GATEWAY_GOOGLE_PAYMENT_PARSING_ERROR',
        error: {message: 'some-error'}
      }]);

      return this.instance.tokenize(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.type).to.equal('UNKNOWN');
        expect(err.code).to.equal('PAYMENT_REQUEST_GOOGLE_PAYMENT_PARSING_ERROR');
        expect(err.message).to.equal('Something went wrong when tokenizing the Google Pay card.');
        expect(err.details.originalError).to.deep.equal({
          name: 'BRAINTREE_GATEWAY_GOOGLE_PAYMENT_PARSING_ERROR',
          error: {message: 'some-error'}
        });
      });
    });

    it('defaults payment request error to customer if not type is passed', function () {
      Bus.prototype.emit.withArgs('payment-request:PAYMENT_REQUEST_INITIALIZED').yieldsAsync([{
        code: 'A_BT_ERROR',
        type: 'CUSTOMER',
        message: 'some error'
      }]);

      return this.instance.tokenize(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err.type).to.equal('CUSTOMER');
      });
    });
  });

  describe('createSupportedPaymentMethodsConfiguration', function () {
    it('throws an error if provided type is not provided', function (done) {
      try {
        this.instance.createSupportedPaymentMethodsConfiguration();
      } catch (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.type).to.equal('MERCHANT');
        expect(err.code).to.equal('PAYMENT_REQUEST_CREATE_SUPPORTED_PAYMENT_METHODS_CONFIGURATION_MUST_INCLUDE_TYPE');
        expect(err.message).to.equal('createSupportedPaymentMethodsConfiguration must include a type parameter.');
        done();
      }
    });

    it('throws an error if provided type is not enabled for the merchant', function (done) {
      try {
        this.instance.createSupportedPaymentMethodsConfiguration('foo');
      } catch (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.type).to.equal('MERCHANT');
        expect(err.code).to.equal('PAYMENT_REQUEST_CREATE_SUPPORTED_PAYMENT_METHODS_CONFIGURATION_TYPE_NOT_ENABLED');
        expect(err.message).to.equal('createSupportedPaymentMethodsConfiguration type parameter must be valid or enabled.');
        done();
      }
    });

    it('returns the default payment request object for provided type', function () {
      var basicCardConfiguration = this.instance.createSupportedPaymentMethodsConfiguration('basicCard');
      var googlePaymentConfiguration = this.instance.createSupportedPaymentMethodsConfiguration('googlePay');

      expect(basicCardConfiguration).to.deep.equal({
        supportedMethods: 'basic-card',
        data: {
          supportedNetworks: ['amex', 'discover', 'visa']
        }
      });
      expect(googlePaymentConfiguration).to.deep.equal({
        supportedMethods: 'https://google.com/pay',
        data: {
          merchantId: '18278000977346790994',
          apiVersion: 1,
          environment: 'TEST',
          allowedPaymentMethods: ['CARD', 'TOKENIZED_CARD'],
          paymentMethodTokenizationParameters: {
            tokenizationType: 'PAYMENT_GATEWAY',
            parameters: {
              gateway: 'braintree',
              'braintree:merchantId': 'merchant-id',
              'braintree:authorizationFingerprint': 'fingerprint',
              'braintree:apiVersion': 'v1',
              'braintree:sdkVersion': VERSION,
              'braintree:metadata': '{"source":"client","integration":"custom","sessionId":"fakeSessionId","version":"' + VERSION + '","platform":"web"}'
            }
          },
          cardRequirements: {
            allowedCardNetworks: ['VISA', 'AMEX']
          }
        }
      });
    });

    it('can overwrite the defaults provided in data', function () {
      var basicCardConfiguration = this.instance.createSupportedPaymentMethodsConfiguration('basicCard', {
        supportedNetworks: ['visa'],
        supportedTypes: ['credit']
      });
      var googlePaymentConfiguration = this.instance.createSupportedPaymentMethodsConfiguration('googlePay', {
        environment: 'PROD',
        apiVersion: 2
      });

      expect(basicCardConfiguration).to.deep.equal({
        supportedMethods: 'basic-card',
        data: {
          supportedNetworks: ['visa'],
          supportedTypes: ['credit']
        }
      });
      expect(googlePaymentConfiguration).to.deep.equal({
        supportedMethods: 'https://google.com/pay',
        data: {
          merchantId: '18278000977346790994',
          apiVersion: 2,
          environment: 'PROD',
          allowedPaymentMethods: ['CARD', 'TOKENIZED_CARD'],
          paymentMethodTokenizationParameters: {
            tokenizationType: 'PAYMENT_GATEWAY',
            parameters: {
              gateway: 'braintree',
              'braintree:merchantId': 'merchant-id',
              'braintree:authorizationFingerprint': 'fingerprint',
              'braintree:apiVersion': 'v1',
              'braintree:sdkVersion': VERSION,
              'braintree:metadata': '{"source":"client","integration":"custom","sessionId":"fakeSessionId","version":"' + VERSION + '","platform":"web"}'
            }
          },
          cardRequirements: {
            allowedCardNetworks: ['VISA', 'AMEX']
          }
        }
      });
    });

    it('will leave default properties if not specified', function () {
      var basicCardConfiguration = this.instance.createSupportedPaymentMethodsConfiguration('basicCard', {
        supportedTypes: ['credit']
      });
      var googlePaymentConfiguration = this.instance.createSupportedPaymentMethodsConfiguration('googlePay', {
        environment: 'PROD',
        apiVersion: 2
      });

      expect(basicCardConfiguration).to.deep.equal({
        supportedMethods: 'basic-card',
        data: {
          supportedNetworks: ['amex', 'discover', 'visa'],
          supportedTypes: ['credit']
        }
      });

      expect(googlePaymentConfiguration).to.deep.equal({
        supportedMethods: 'https://google.com/pay',
        data: {
          merchantId: '18278000977346790994',
          apiVersion: 2,
          environment: 'PROD',
          allowedPaymentMethods: ['CARD', 'TOKENIZED_CARD'],
          paymentMethodTokenizationParameters: {
            tokenizationType: 'PAYMENT_GATEWAY',
            parameters: {
              gateway: 'braintree',
              'braintree:merchantId': 'merchant-id',
              'braintree:authorizationFingerprint': 'fingerprint',
              'braintree:apiVersion': 'v1',
              'braintree:sdkVersion': VERSION,
              'braintree:metadata': '{"source":"client","integration":"custom","sessionId":"fakeSessionId","version":"' + VERSION + '","platform":"web"}'
            }
          },
          cardRequirements: {
            allowedCardNetworks: ['VISA', 'AMEX']
          }
        }
      });
    });
  });

  describe('canMakePayment', function () {
    beforeEach(function () {
      this.originalPaymentRequest = global.PaymentRequest;
      global.PaymentRequest = this.originalPaymentRequest || {};

      this.configuration = {
        details: {},
        options: {}
      };
      this.pr = new PaymentRequestComponent({
        client: this.fakeClient
      });

      Bus.prototype.emit.yieldsAsync([null, true]);
    });

    afterEach(function () {
      global.PaymentRequest = this.originalPaymentRequest;
    });

    it('emits a canMakePayment event', function () {
      return this.pr.canMakePayment(this.configuration).then(function () {
        expect(Bus.prototype.emit).to.be.calledOnce;
        expect(Bus.prototype.emit).to.be.calledWith('payment-request:CAN_MAKE_PAYMENT', this.sandbox.match(this.configuration));
      }.bind(this));
    });

    it('defaults to default supported payment methods if not passed in with configuration', function () {
      delete this.configuration.supportedPaymentMethods;
      this.pr._defaultSupportedPaymentMethods = ['googlepay'];

      return this.pr.canMakePayment(this.configuration).then(function () {
        expect(Bus.prototype.emit).to.be.calledOnce;
        expect(Bus.prototype.emit).to.be.calledWithMatch('payment-request:CAN_MAKE_PAYMENT', {
          supportedPaymentMethods: ['googlepay']
        });
      });
    });

    it('resolves with `true` if Bus responds with `true`', function () {
      Bus.prototype.emit.yieldsAsync([null, true]);

      return this.pr.canMakePayment(this.configuration).then(function (result) {
        expect(result).to.equal(true);
        expect(analytics.sendEvent).to.be.calledOnce;
        expect(analytics.sendEvent).to.be.calledWith(this.fakeClient, 'payment-request.can-make-payment.true');
      }.bind(this));
    });

    it('resolves with `false` if Bus responds with `false`', function () {
      Bus.prototype.emit.yieldsAsync([null, false]);

      return this.pr.canMakePayment(this.configuration).then(function (result) {
        expect(result).to.equal(false);
        expect(analytics.sendEvent).to.be.calledOnce;
        expect(analytics.sendEvent).to.be.calledWith(this.fakeClient, 'payment-request.can-make-payment.false');
      }.bind(this));
    });

    it('resolves with `false` if Payment Request global is not present', function () {
      Bus.prototype.emit.yieldsAsync([null, true]);

      delete global.PaymentRequest;

      return this.pr.canMakePayment(this.configuration).then(function (result) {
        expect(result).to.equal(false);
        expect(analytics.sendEvent).to.be.calledOnce;
        expect(analytics.sendEvent).to.be.calledWith(this.fakeClient, 'payment-request.can-make-payment.not-available');
      }.bind(this));
    });

    it('rejects if supportedPaymentMethods that are not compatible with the SDK are passed in', function () {
      this.configuration.supportedPaymentMethods = [{
        supportedMethods: 'basic-card'
      }, {
        supportedMethods: 'foopay'
      }, {
        supportedMethods: 'https://google.com/pay'
      }];

      return this.pr.canMakePayment(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.code).to.equal('PAYMENT_REQUEST_UNSUPPORTED_PAYMENT_METHOD');
        expect(err.message).to.equal('foopay is not a supported payment method.');
      });
    });

    it('resolves if supportedPaymentMethods that are compatible with the SDK are passed in', function () {
      Bus.prototype.emit.yieldsAsync([null, true]);

      this.configuration.supportedPaymentMethods = [{
        supportedMethods: 'basic-card'
      }, {
        supportedMethods: 'https://google.com/pay'
      }];

      return this.pr.canMakePayment(this.configuration).then(function (result) {
        expect(result).to.equal(true);
      });
    });

    it('rejects if supportedPaymentMethods in array notation that are not compatible with the SDK are passed in', function () {
      this.configuration.supportedPaymentMethods = [{
        supportedMethods: ['basic-card']
      }, {
        supportedMethods: ['foopay']
      }, {
        supportedMethods: ['https://google.com/pay']
      }];

      return this.pr.canMakePayment(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.code).to.equal('PAYMENT_REQUEST_UNSUPPORTED_PAYMENT_METHOD');
        expect(err.message).to.equal('foopay is not a supported payment method.');
      });
    });

    it('resolves if supportedPaymentMethods in array notation that are compatible with the SDK are passed in', function () {
      Bus.prototype.emit.yieldsAsync([null, true]);

      this.configuration.supportedPaymentMethods = [{
        supportedMethods: ['basic-card']
      }, {
        supportedMethods: ['https://google.com/pay']
      }];

      return this.pr.canMakePayment(this.configuration).then(function (result) {
        expect(result).to.equal(true);
      });
    });

    it('rejects if bus replies with an error', function () {
      var error = new Error('error');

      Bus.prototype.emit.yieldsAsync([error]);

      return this.pr.canMakePayment(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.code).to.equal('PAYMENT_REQUEST_CAN_MAKE_PAYMENT_FAILED');
        expect(err.details.originalError).to.equal(error);
        expect(analytics.sendEvent).to.be.calledOnce;
        expect(analytics.sendEvent).to.be.calledWith(this.fakeClient, 'payment-request.can-make-payment.failed');
      }.bind(this));
    });

    it('rejects with a payment request initialization failed error', function () {
      var error = new Error('error');

      error.name = 'PAYMENT_REQUEST_INITIALIZATION_FAILED';

      Bus.prototype.emit.yieldsAsync([error]);

      return this.pr.canMakePayment(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.code).to.equal('PAYMENT_REQUEST_INITIALIZATION_MISCONFIGURED');
        expect(err.details.originalError).to.equal(error);
        expect(analytics.sendEvent).to.be.calledOnce;
        expect(analytics.sendEvent).to.be.calledWith(this.fakeClient, 'payment-request.can-make-payment.failed');
      }.bind(this));
    });

    it('rejects with a not allowed error', function () {
      var error = new Error('error');

      error.name = 'NotAllowedError';

      Bus.prototype.emit.yieldsAsync([error]);

      return this.pr.canMakePayment(this.configuration).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.code).to.equal('PAYMENT_REQUEST_CAN_MAKE_PAYMENT_NOT_ALLOWED');
        expect(err.details.originalError).to.equal(error);
        expect(analytics.sendEvent).to.be.calledOnce;
        expect(analytics.sendEvent).to.be.calledWith(this.fakeClient, 'payment-request.can-make-payment.failed');
      }.bind(this));
    });
  });

  describe('teardown', function () {
    beforeEach(function (done) {
      this.sandbox.stub(Bus.prototype, 'teardown');
      this.instance.initialize().then(function () {
        done();
      });

      setTimeout(function () {
        var handler = Bus.prototype.on.withArgs('payment-request:FRAME_CAN_MAKE_REQUESTS').args[0][1];

        handler();
      }, 100);
    });

    it('tears down bus', function () {
      return this.instance.teardown().then(function () {
        expect(Bus.prototype.teardown).to.be.calledOnce;
      });
    });

    it('removes iframe from page', function () {
      expect(document.querySelector('iframe[name="braintree-payment-request-frame"]')).to.exist;

      return this.instance.teardown().then(function () {
        expect(document.querySelector('iframe[name="braintree-payment-request-frame"]')).to.not.exist;
      });
    });

    it('calls teardown analytics', function () {
      return this.instance.teardown().then(function () {
        expect(analytics.sendEvent).to.be.calledWith(this.instance._client, 'payment-request.teardown-completed');
      }.bind(this));
    });

    it('replaces all methods so error is thrown when methods are invoked', function (done) {
      var instance = this.instance;

      instance.teardown().then(function () {
        methods(PaymentRequestComponent.prototype).forEach(function (method) {
          var error;

          try {
            instance[method]();
          } catch (err) {
            error = err;
          }

          expect(error).to.be.an.instanceof(BraintreeError);
          expect(error.type).to.equal(BraintreeError.types.MERCHANT);
          expect(error.code).to.equal('METHOD_CALLED_AFTER_TEARDOWN');
          expect(error.message).to.equal(method + ' cannot be called after teardown.');
        });

        done();
      });
    });
  });
});
