import React from 'react';
import { Store as UserPreferencesStore } from "../../stores/UserPreferencesStore";

export default class General extends React.Component {
    constructor(props) {
        super(props);
    }
    render() {
        return <div className="complex-menu-content-section">General Preferences section </div>
    }
}