sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"cfoaiagent/cfoaiagent/test/integration/pages/ConversationsMain"
], function (JourneyRunner, ConversationsMain) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('cfoaiagent/cfoaiagent') + '/test/flpSandbox.html#cfoaiagentcfoaiagent-tile',
        pages: {
			onTheConversationsMain: ConversationsMain
        },
        async: true
    });

    return runner;
});

