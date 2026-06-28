import React, { Component } from 'react';
import { withStyles } from '@material-ui/core/styles';
import TextField from '@material-ui/core/TextField';

import I18n from '@iobroker/adapter-react/i18n';

/**
 * @type {(_theme: import("@material-ui/core/styles").Theme) => import("@material-ui/styles").StyleRules}
 */
const styles = (_theme) => ({
	tab: {
		width: '100%',
		minHeight: '100%',
		padding: 20,
	},
	input: {
		marginTop: 10,
		minWidth: 300,
	},
});

class Settings extends Component {
	render() {
		const { classes, native, onChange } = this.props;

		return (
			<div className={classes.tab}>
				{/* Hier wird die Überschrift angezeigt */}
				<h1>{I18n.t('beregnungswerk adapter settings')}</h1>

				{/* DEIN ERSTES EINGABEFELD: IP-Adresse */}
				<div>
					<TextField
						className={classes.input}
						label={I18n.t('ip_address')}
						value={native.ipAddress || ''}
						onChange={(e) => onChange('ipAddress', e.target.value)}
					/>
				</div>
			</div>
		);
	}
}

export default withStyles(styles)(Settings);
