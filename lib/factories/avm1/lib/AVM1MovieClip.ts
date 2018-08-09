/**
 * Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {DEPTH_OFFSET, getAwayJSAdaptee, getAwayObjectOrTemplate,
	getAVM1Object,
	hasAwayJSAdaptee,
	IAVM1SymbolBase, initializeAVM1Object,
	wrapAVM1NativeClass, toTwipFloor, avm2AwayDepth, away2avmDepth
} from "./AVM1Utils";
import {
	alCoerceNumber, alCoerceString, alForEachProperty, alInstanceOf, alIsName, alNewObject, alToBoolean, alToInt32,
	alToNumber,
	alToString, AVM1PropertyFlags
} from "../runtime";
import {AVM1Context} from "../context";
import {release, assert, Debug, notImplemented, somewhatImplemented, warning} from "../../base/utilities/Debug";
import {isNullOrUndefined} from "../../base/utilities";
import {AVM1BitmapData, toAS3BitmapData} from "./AVM1BitmapData";
import {toAS3Matrix} from "./AVM1Matrix";
import {AVM1ArrayNative} from "../natives";
import {FlashNetScript_navigateToURL} from "../../AVM2Dummys";
import {copyAS3PointTo, toAS3Point} from "./AVM1Point";
import {MovieClipProperties} from "../interpreter/MovieClipProperties";
import {
	IMovieClipAdapter, DisplayObjectContainer, DisplayObject, MovieClip, TextField, Sprite, Billboard
} from "@awayjs/scene";
import {Rectangle, Point, WaveAudio} from "@awayjs/core";
import {AVM1TextField} from "./AVM1TextField";
import {constructClassFromSymbol} from "../../link";
import {Graphics} from "@awayjs/graphics";
import {Matrix3D} from "@awayjs/core";
import {BitmapImage2D as Bitmap} from "@awayjs/stage";
import {LoaderInfo} from "../../customAway/LoaderInfo";
import {AVM1SymbolBase} from "./AVM1SymbolBase";
import {AVM1Object} from "../runtime/AVM1Object";
import {AVM1Stage} from "./AVM1Stage";

import {AVMRaycastPicker} from "../../AVMRaycastPicker";
import { AVM1PropertyDescriptor } from "../runtime/AVM1PropertyDescriptor";
import { AVM1EventHandler, AVM1MovieClipButtonModeEvent } from "./AVM1EventHandler";
import {AVM1LoaderHelper} from "./AVM1LoaderHelper";

class SpriteSymbol{
	avm1Name:string;
}

export interface IFrameScript {
	(any?): any;
	precedence?: number[];
	context?: MovieClip;
}

enum StateTransitions {
	IdleToOverUp =      0x001, // roll over
	OverUpToIdle =      0x002, // roll out
	OverUpToOverDown =  0x004, // press
	OverDownToOverUp =  0x008, // release
	OverDownToOutDown = 0x010, // drag out
	OutDownToOverDown = 0x020, // drag over
	OutDownToIdle =     0x040, // release outside
	IdleToOverDown =    0x080, // ???
	OverDownToIdle =    0x100  // ???
}

export const enum LookupChildOptions {
	DEFAULT = 0,
	IGNORE_CASE = 1,
	INCLUDE_NON_INITIALIZED = 2
}



function convertAS3RectangeToBounds(as3Rectange: Rectangle): AVM1Object {
	var result = alNewObject(this.context);
	result.alPut('xMin', as3Rectange.axGetPublicProperty('left'));
	result.alPut('yMin', as3Rectange.axGetPublicProperty('top'));
	result.alPut('xMax', as3Rectange.axGetPublicProperty('right'));
	result.alPut('yMax', as3Rectange.axGetPublicProperty('bottom'));
	return result;
}

export class AVM1MovieClip extends AVM1SymbolBase<MovieClip> implements IMovieClipAdapter {
	public static createAVM1Class(context: AVM1Context): AVM1Object {
		return wrapAVM1NativeClass(context, true, AVM1MovieClip,
			[],
			['$version#', '_alpha#', 'getAwayJSID', 'attachAudio', 'attachBitmap', 'attachMovie',
				'beginFill', 'beginBitmapFill', 'beginGradientFill', 'blendMode#',
				'cacheAsBitmap#', '_callFrame', 'clear', 'createEmptyMovieClip',
				'createTextField', '_currentframe#', 'curveTo', '_droptarget#',
				'duplicateMovieClip', 'enabled#', 'endFill', 'filters#', '_framesloaded#',
				'_focusrect#', 'forceSmoothing#', 'getBounds',
				'getBytesLoaded', 'getBytesTotal', 'getDepth', 'getInstanceAtDepth',
				'getNextHighestDepth', 'getRect', 'getSWFVersion', 'getTextSnapshot',
				'getURL', 'globalToLocal', 'gotoAndPlay', 'gotoAndStop', '_height#',
				'_highquality#', 'hitArea#', 'hitTest', 'lineGradientStyle', 'lineStyle',
				'lineTo', 'loadMovie', 'loadVariables', 'localToGlobal', '_lockroot#',
				'menu#', 'moveTo', '_name#', 'nextFrame', 'opaqueBackground#', '_parent#',
				'play', 'prevFrame', '_quality#', 'removeMovieClip', '_root#', '_rotation#',
				'scale9Grid#', 'scrollRect#', 'setMask', '_soundbuftime#', 'startDrag',
				'stop', 'stopDrag', 'swapDepths', 'tabChildren#', 'tabEnabled#', 'tabIndex#',
				'_target#', '_totalframes#', 'trackAsMenu#', 'transform#', 'toString',
				'unloadMovie', '_url#', 'useHandCursor#', '_visible#', '_width#',
				'_x#', '_xmouse#', '_xscale#', '_y#', '_ymouse#', '_yscale#']);
	}

	public static capStyleMapStringToInt:any={"none":0, "round":1, "square":2};
	public static jointStyleMapStringToInt:any={"round":0, "bevel":1, "miter":2};

	public clone(){
		return <AVM1MovieClip>getAVM1Object(this.adaptee.clone(), <AVM1Context>this._avm1Context);
	}

	// this is used for ordering AVM1 Framescripts into correct order
	private compareAVM1FrameScripts(a:IFrameScript, b: IFrameScript): number {
		if (!a.precedence) {
			return !b.precedence ? 0 : -1;
		} else if (!b.precedence) {
			return 1;
		}
		var i = 0;
		while (i < a.precedence.length && i < b.precedence.length && a.precedence[i] === b.precedence[i]) {
			i++;
		}
		if (i >= a.precedence.length) {
			return a.precedence.length === b.precedence.length ? 0 : -1;
		} else {
			return i >= b.precedence.length ? 1 : a.precedence[i] - b.precedence[i];
		}
	}
	public executeScript(actionsBlocks:any){
		
		var name:string=this.adaptee.name.replace(/[^\w]/g,'');
		if(!actionsBlocks){
			window.alert("actionsBlocks is empty, can not execute framescript"+ name+ this.adaptee.currentFrameIndex);
			return;
		}
		var unsortedScripts:any[]=[];
				
		for (let k = 0; k < actionsBlocks.length; k++) {
			let actionsBlock:any = actionsBlocks[k];
			let script:IFrameScript= function (actionsData) {
				(<any>this)._avm1Context.executeActions(actionsData, this);
			}.bind(this, actionsBlock.data);

			// this uses parents of current scenegraph. so its not possible to easy preset in parser 
			script.precedence = this.adaptee.getScriptPrecedence().concat(actionsBlock.precedence);

			script.context = this.adaptee;
			unsortedScripts.push(script);
		}
		if (unsortedScripts.length) {
			unsortedScripts.sort(this.compareAVM1FrameScripts);
			var sortedFrameScripts = unsortedScripts;
			for (let k = 0; k < sortedFrameScripts.length; k++) {
				var myScript = sortedFrameScripts[k];
				var mc = myScript.context;
				myScript.call(mc);
			}
		}		
	}
	public addScript(source:any, frameIdx:number):any{
		let actionsBlocks=source;
		var translatedScripts:any[]=[];
		for (let i = 0; i < actionsBlocks.length; i++) {
			let actionsBlock = actionsBlocks[i];
			var mcName:any=this.adaptee.name;
			if(typeof mcName!="string"){
				mcName=mcName.toString();
			}
			actionsBlock.data=(<AVM1Context>this._avm1Context).actionsDataFactory.createActionsData(
				actionsBlock.actionsData, 'script_'+mcName.replace(/[^\w]/g,'')+"_"+this.adaptee.id+'_frame_' + frameIdx + '_idx_' + i);
			translatedScripts[translatedScripts.length]=actionsBlock;			
		}
		return translatedScripts;
	}

	
	public stopAllSounds() {
		var allProps=this.alGetKeys();
		for(var i=0;i<allProps.length;i++){
			var desc=this.alGetProperty(allProps[i]);
			var val=desc?desc.value:null;
			if(val && val._sound && val._sound.isAsset && val._sound.isAsset(WaveAudio)){

				val.stop();
			}
		}
		var child:DisplayObject;
		i=this.adaptee.numChildren;
		while(i>0){
			i--;
			child=this.adaptee.getChildAt(i);
			if(child.isAsset(MovieClip) && child.adapter!=child){
				(<IMovieClipAdapter>child.adapter).freeFromScript();
			}
		}
	}
	// called from adaptee whenever this is removed from scene.
	public freeFromScript():void{
		this.stopAllSounds();
		this._blockedByScript=false;
		this._ctBlockedByScript=false;
		this._visibilityByScript=false;
	}
	
	public doInitEvents():void
	{
		this._dropTarget="";
		for (var key in this.adaptee.timeline.avm1InitActions)
			this.executeScript(this.addScript(this.adaptee.timeline.avm1InitActions[key], <any> ("initActionsData" + key)));

		if((<any>this).initEvents){
			initializeAVM1Object(this.adaptee, <AVM1Context>this._avm1Context, (<any>this).initEvents);
		}
	}


	private _unregisteredChilds:any={};

	public registerScriptObject(child:DisplayObject):void
	{

		if(child.adapter!=child)
			(<any>child.adapter).setEnabled(true);
		if (child.name){
			if(!this._childrenByName[child.name] || (this._childrenByName[child.name].adaptee && this._childrenByName[child.name].adaptee.parent==null)){
				this.alPut(child.name, child.adapter);
				this._childrenByName[child.name]=child._adapter;
			}
			else{
				
				this._unregisteredChilds[child.name]=child;
			}
		}
	}

	public unregisterScriptObject(child:DisplayObject):void
	{
		if(child && child.adapter != child)
			(<any>child.adapter).alPut("onEnterFrame", null);
		if(child.name){
			if(this._childrenByName[child.name] && this._childrenByName[child.name].adaptee.id==child.id){
				if(this._unregisteredChilds[child.name]){					
					this.alPut(child.name, this._unregisteredChilds[child.name].adapter);
					this._childrenByName[child.name]=this._unregisteredChilds[child.name].adapter;
					delete this._unregisteredChilds[child.name];
				}
				else{					
					this.alDeleteProperty(child.name);
					delete this._childrenByName[child.name];
				}
			}
			if(this._unregisteredChilds[child.name] && this._unregisteredChilds[child.name].adaptee.id==child.id){
				delete this._unregisteredChilds[child.name];
			}
		}
	}


	private _hitArea: any;
	private _lockroot: boolean;

	private get graphics() : Graphics {
		return this.adaptee.graphics;
	}
	public initAVM1SymbolInstance(context: AVM1Context, awayObject: any) {//MovieClip
		this._childrenByName = Object.create(null);
		super.initAVM1SymbolInstance(context, awayObject);
		this.dragListenerDelegate = (event) => this.dragListener(event);
		this.stopDragDelegate = (event) => this.stopDrag(event);

		this.dynamicallyCreated=false;
		this.adaptee=awayObject;
		this._initEventsHandlers();
	}

	_lookupChildByName(name: string): AVM1Object {
		release || assert(alIsName(this.context, name));
		return this._childrenByName[name];
	}

	private _lookupChildInAS3Object(name: string): AVM1Object {
		var lookupOptions = LookupChildOptions.INCLUDE_NON_INITIALIZED;
		if (!this.context.isPropertyCaseSensitive) {
			lookupOptions |= LookupChildOptions.IGNORE_CASE;
		}
		//80pro todo lookupOptions
		var as3Child = this.adaptee.getChildByName(name);//, lookupOptions);
		return getAVM1Object(as3Child, this.context);
	}

	public get __targetPath() {
		//return "";
		var target = this.get_target();
		var as3Root = this.adaptee.root;
		release || Debug.assert(as3Root);
		var level = this.context.levelsContainer._getLevelForRoot(as3Root);
		release || Debug.assert(level >= 0);
		var prefix = '_level' + level;
		return target != '/' ? prefix + target.replace(/\//g, '.') : prefix;

	}
	
	public getAwayJSID(): number {
		return this.adaptee.id;
	}
	public attachAudio(id: any): void {
		if (isNullOrUndefined(id)) {
			return; // ignoring all undefined objects, probably nothing to attach
		}
		if (id === false) {
			return; // TODO stop playing all attached audio source (when implemented).
		}
		// TODO implement NetStream and Microphone objects to make this work.
		notImplemented('AVM1MovieClip.attachAudio');
	}

	public attachBitmap(bmp:AVM1BitmapData, depth:number, pixelSnapping:string = 'auto', smoothing:boolean = false): void {
		pixelSnapping = alCoerceString(this.context, pixelSnapping);
		smoothing = alToBoolean(this.context, smoothing);
		var as3BitmapData = bmp.as3BitmapData;
		var bitmap: Bitmap = this.context.sec.flash.display.Bitmap.axClass.axConstruct([as3BitmapData, pixelSnapping, smoothing]);
		notImplemented('AVM1MovieClip.attachBitmap');
		//this._insertChildAtDepth(bitmap, depth);
	}

	public _constructMovieClipSymbol(symbolId:string, name:string): MovieClip {
		symbolId = alToString(this.context, symbolId);
		name = alToString(this.context, name);

		var symbol = this.context.getAsset(symbolId);
		if (!symbol) {
			return undefined;
		}

		/*
		var props: SpriteSymbol = Object.create(symbol.symbolProps);
		props.avm1Name = name;
		*/
		var mc:MovieClip;
		mc = (<any>symbol.symbolProps).clone();//constructClassFromSymbol(props, this.context.sec.flash.display.MovieClip.axClass);
		mc.name=name;
		getAVM1Object(mc,<any>this._avm1Context);
		return mc;
	}

	public get$version(): string {
		return this.context.sec.flash.system.Capabilities.version;
	}

	public rgbaToArgb(float32Color:number):number
	{
		var r:number = ( float32Color & 0xff000000 ) >>> 24;
		var g:number = ( float32Color & 0xff0000 ) >>> 16;
		var b:number = ( float32Color & 0xff00 ) >>> 8;
		var a:number = float32Color & 0xff;
		return (a << 24) | (r << 16) | (g << 8) | b;
	}
	public attachMovie(symbolId, name, depth, initObject) {
		
		var mc = this._constructMovieClipSymbol(symbolId, name);
		if (!mc) {
			return undefined;
		}
		depth = alToNumber(this.context, depth);

		var oldAVMMC=this._childrenByName[name];

		//console.log("attachMovie", name, avm2AwayDepth(depth));
		var avmMc = <AVM1MovieClip>this._insertChildAtDepth(mc, avm2AwayDepth(depth));
		if (initObject) {
			avmMc._init(initObject);
		}
		if(oldAVMMC && oldAVMMC.avmColor){
			oldAVMMC.avmColor.changeTarget(avmMc);
		}
		this.registerScriptObject(mc);
		avmMc.dynamicallyCreated=true;
		return avmMc;
	}

	public beginFill(color: number, alpha: number = 100): void {
		color = alToInt32(this.context, color);
		alpha = alToNumber(this.context, alpha);
		this.graphics.beginFill(color, alpha / 100.0);
	}

	public beginBitmapFill(bmp: AVM1BitmapData, matrix: AVM1Object = null,
						   repeat: boolean = false, smoothing: boolean = false): void {
		if (!alInstanceOf(this.context, bmp, this.context.globals.BitmapData)) {
			return; // skipping operation if first parameter is not a BitmapData.
		}
		var bmpNative = toAS3BitmapData(bmp);
		var matrixNative = isNullOrUndefined(matrix) ? null : toAS3Matrix(matrix);
		repeat = alToBoolean(this.context, repeat);
		smoothing = alToBoolean(this.context, smoothing);

		notImplemented('AVM1MovieClip.beginBitmapFill');
		//this.graphics.beginBitmapFill(bmpNative.adaptee, matrixNative, repeat, smoothing);
	}

	public beginGradientFill(fillType: string, colors: AVM1Object, alphas: AVM1Object,
							 ratios: AVM1Object, matrix: AVM1Object,
							 spreadMethod: string = 'pad', interpolationMethod: string = 'rgb',
							 focalPointRatio: number = 0.0): void {
		var context = this.context, sec = context.sec;
		fillType = alToString(this.context, fillType);
		var colorsNative = sec.createArray(
			AVM1ArrayNative.mapToJSArray(colors, (item) => alToInt32(this.context, item)));
		var alphasNative = sec.createArray(
			AVM1ArrayNative.mapToJSArray(alphas, (item) => alToNumber(this.context, item) / 100.0));
		var ratiosNative = sec.createArray(
			AVM1ArrayNative.mapToJSArray(ratios, (item) => alToNumber(this.context, item)));
		var matrixNative = null;
		if (isNullOrUndefined(matrix)) {
			somewhatImplemented('AVM1MovieClip.beginGradientFill');
		}
		spreadMethod = alToString(this.context, spreadMethod);
		interpolationMethod = alToString(this.context, interpolationMethod);
		focalPointRatio = alToNumber(this.context, focalPointRatio);
		this.graphics.beginGradientFill(fillType, colorsNative, alphasNative, ratiosNative, matrixNative,
			spreadMethod, interpolationMethod, focalPointRatio);
	}
	
	public _callFrame(frame:any):any {		
		var script;
		if (typeof frame === "string")
			script=this.adaptee.timeline.getScriptForLabel(this.adaptee, frame);
		else if(typeof frame === "number")
			script = this.adaptee.timeline.get_script_for_frame(this.adaptee, frame-1);
		if(script)
			this.executeScript(script);
	}



	public clear(): void {
		this.graphics.clear();
	}

	/**
	 * This map stores the AVM1MovieClip's children keyed by their names. It's updated by all
	 * operations that can cause different results for name-based lookups. these are
	 * addition/removal of children and swapDepths.
	 *
	 * Using this map instead of always relaying lookups to the AVM2 MovieClip substantially
	 * reduces the time spent in looking up children. In some cases by two orders of magnitude.
	 */
	private _childrenByName: Map<string, AVM1MovieClip>;

	private _insertChildAtDepth<T extends DisplayObject>(mc: T, depth:number): AVM1Object {
		this.adaptee.addChildAtDepth(mc, depth);
		return getAVM1Object(mc, <AVM1Context>this._avm1Context);
	}

	public _updateChildName(child: AVM1MovieClip, oldName: string, newName: string) {
		oldName && this._removeChildName(child, oldName);
		newName && this._addChildName(child, newName);
	}
	_removeChildName(child: IAVM1SymbolBase, name: string) {
		release || assert(name);
		if (!this.context.isPropertyCaseSensitive) {
			name = name.toLowerCase();
		}
		if(!this._childrenByName || !this._childrenByName[name])
			return;
		if (this._childrenByName[name] !== child) {
			return;
		}
		var newChildForName = this._lookupChildInAS3Object(name);
		if (newChildForName) {
			this._childrenByName[name] = newChildForName;
		} else {
			delete this._childrenByName[name];
		}
	}

	_addChildName(child: IAVM1SymbolBase, name: string) {
		release || assert(name);
		if (!this.context.isPropertyCaseSensitive) {
			name = name.toLowerCase();
		}
		release || assert(this._childrenByName[name] !== child);
		var currentChild = this._childrenByName[name];
		if (!currentChild || currentChild.getDepth() > child.getDepth()) {
			this._childrenByName[name] = child;
		}
	}

	public createEmptyMovieClip(name, depth): AVM1MovieClip {
		name = alToString(this.context, name);
		var mc: MovieClip = new this.context.sec.flash.display.MovieClip();
		mc.name = name;
		getAVM1Object(mc,  <AVM1Context>this._avm1Context);
		//console.log("createEmptyMovieClip", name, avm2AwayDepth(depth));
		var avmMC:AVM1MovieClip=<AVM1MovieClip>this._insertChildAtDepth(mc, avm2AwayDepth(depth));
		this.registerScriptObject(mc);
		// dynamicallyCreated needs to be set after adding child, otherwise it gets reset
		avmMC.dynamicallyCreated=true;
		return avmMC;
	}


	public createTextField(name, depth, x, y, width, height): AVM1TextField {
		name = alToString(this.context, name);
		var text: TextField = new this.context.sec.flash.text.TextField();
		text.name = name;
		text.x = x;
		text.y = y;
		text.width = width;
		text.height = height;
		getAVM1Object(text,  <AVM1Context>this._avm1Context);
		var myTF=<AVM1TextField>this._insertChildAtDepth(text,  avm2AwayDepth(depth));
		this.registerScriptObject(text);
		return myTF;
	}

	public get_currentframe() {
		return this.adaptee.currentFrameIndex+1;
	}

	public curveTo(controlX: number, controlY: number, anchorX: number, anchorY: number): void {
		controlX = alToNumber(this.context, controlX);
		controlY = alToNumber(this.context, controlY);
		anchorX = alToNumber(this.context, anchorX);
		anchorY = alToNumber(this.context, anchorY);
		this.graphics.curveTo(controlX, controlY, anchorX, anchorY);
	}

	private _dropTarget:string;
	public setDropTarget(dropTarget:DisplayObject) {
		if(dropTarget){
			//console.log((<AVMRaycastPicker>AVM1Stage.stage.view.mousePicker).getDropTarget().name);
			var names:string[]=[];
			while (dropTarget){
				if(dropTarget.name=="scene"){
					dropTarget=null;
				}
				else{
					names.push(dropTarget.name);
					dropTarget=dropTarget.parent;
				}
			}
			var i:number=names.length;
			var mc_path:string="";
			while(i>0){
				mc_path+="/";
				i--;
				mc_path+=names[i];
			}
			//console.log(mc_path);
			
			this._dropTarget=mc_path;
			return;

		}
		this._dropTarget="";
	}
	public get_droptarget() {
		return this._dropTarget;

	}

	public duplicateMovieClip(name, depth, initObject): AVM1MovieClip {
		name = alToString(this.context, name);
		if(name==this.adaptee.name){
			return this;
		}
		var parent = this.get_parent();
		if(!parent){
			warning("AVM1MovieClip.duplicateMovieClip could not get parent");
			parent=this.context.resolveTarget(null);
		}
		var mc: MovieClip;
		if (this.adaptee._symbol) {
			notImplemented('AVM1MovieClip.duplicateMovieClip from symbol');
			//mc = constructClassFromSymbol(nativeAS3Object._symbol, nativeAS3Object.axClass);
		} else {
			mc = (<any>this).clone().adaptee;//new this.context.sec.flash.display.MovieClip();
		}
		mc.name = name;
		(<any>mc.adapter).placeObjectTag=(<any>this).placeObjectTag;
		(<any>mc.adapter).initEvents=(<any>this).initEvents;

		var avmMc = <AVM1MovieClip>parent._insertChildAtDepth(mc,  avm2AwayDepth(depth));
		// dynamicallyCreated needs to be set after adding child, otherwise it gets reset
		avmMc.dynamicallyCreated=true;
		avmMc._avm1Context=this._avm1Context;
		parent.registerScriptObject(mc);

		if (initObject) {
			avmMc._init(initObject);
		}

		var new_matrix:Matrix3D = mc.transform.matrix3D;
		var originalMatrix:Float32Array = this.adaptee.transform.matrix3D._rawData;
		new_matrix._rawData[0] = originalMatrix[0];
		new_matrix._rawData[1] = originalMatrix[1];
		new_matrix._rawData[4] = originalMatrix[4];
		new_matrix._rawData[5] = originalMatrix[5];
		new_matrix._rawData[12] = originalMatrix[12];
		new_matrix._rawData[13] = originalMatrix[13];
		mc.transform.invalidateComponents();

		mc.alpha = this.adaptee.alpha;
		mc.blendMode = this.adaptee.blendMode;
		mc.cacheAsBitmap = this.adaptee.cacheAsBitmap;
		return avmMc;
	}
	public getEnabled() {
		return this.enabled;
	}

	public setEnabled(value) {
		if (value == this.enabled)
			return;
		this.enabled = value;
		this.setEnabledListener(value);
		
	}

	public endFill(): void {
		this.graphics.endFill();
	}

	public getForceSmoothing(): boolean {
		notImplemented('AVM1MovieClip.getForceSmoothing');
		return false;
	}

	public setForceSmoothing(value: boolean) {
		value = alToBoolean(this.context, value);
		notImplemented('AVM1MovieClip.setForceSmoothing');
	}

	public get_framesloaded() {
		notImplemented('AVM1MovieClip.get_framesloaded');
		return 0;//this.adaptee.framesLoaded;
	}

	public getBounds(bounds): AVM1Object {
		var obj = <DisplayObject>getAwayJSAdaptee(bounds);
		if (!obj) {
			return undefined;
		}
		return convertAS3RectangeToBounds(this.adaptee.getBounds(obj));
	}

	public getBytesLoaded(): number {
		//var loaderInfo = this.adaptee.loaderInfo;
		return this.adaptee.currentFrameIndex>=0?100:-1;//loaderInfo.bytesLoaded;
	}

	public getBytesTotal() {
		//var loaderInfo = this.adaptee.loaderInfo;
		return 100;//loaderInfo.bytesTotal;
	}

	public getInstanceAtDepth(depth: number): AVM1MovieClip {
		//Debug.notImplemented('AVM1MovieClip.getInstanceAtDepth');
		// 80pro: why does this always return movieclip ?
		// todo: check if in as3 this could be a textfield
		var child:DisplayObject=this.adaptee.getChildAtDepth( avm2AwayDepth(depth));
		if(!child){
			return null;
		}
		if(child.isAsset(Billboard)){
			return this;
		}
		else if(child.isAsset(MovieClip)){
			return this;
		}
		return <AVM1MovieClip>getAVM1Object(child, this.context);

		/*
		var symbolDepth = alCoerceNumber(this.context, depth) + DEPTH_OFFSET;
		var nativeObject = this.adaptee;
		var lookupChildOptions = LookupChildOptions.INCLUDE_NON_INITIALIZED;
		for (var i = 0, numChildren = nativeObject.numChildren; i < numChildren; i++) {
			var child = nativeObject._lookupChildByIndex(i, lookupChildOptions);
			// child is null if it hasn't been constructed yet. This can happen in InitActionBlocks.
			if (child && child._depth === symbolDepth) {
				// Somewhat absurdly, this method returns the mc if a bitmap is at the given depth.
				if (this.context.sec.flash.display.Bitmap.axIsType(child)) {
					return this;
				}
				return <AVM1MovieClip>getAVM1Object(child, this.context);
			}
		}
		return undefined;
		*/
	}

	public getNextHighestDepth(): number {
		return away2avmDepth(this.adaptee.getNextHighestDepth());
	}

	public getRect(bounds): AVM1Object {
		var obj = <DisplayObject>getAwayJSAdaptee(bounds);
		if (!obj) {
			return undefined;
		}
		return convertAS3RectangeToBounds(this.adaptee.getRect(obj));
	}

	public getSWFVersion(): number {
		var loaderInfo = <LoaderInfo>this.adaptee.loaderInfo;
		return loaderInfo.swfVersion;
	}

	public getTextSnapshot() {
		notImplemented('AVM1MovieClip.getTextSnapshot');
	}

	public getURL(url, window, method) {
		var request = new this.context.sec.flash.net.URLRequest(url);
		if (method) {
			request.method = method;
		}
		FlashNetScript_navigateToURL(request, window);
	}

	public globalToLocal(pt) {
		var tmp = toAS3Point(pt);
		this.adaptee.globalToLocal(tmp, tmp);
		copyAS3PointTo(tmp, pt);
	}

	public gotoAndPlay(frame) {
		if (frame == null)
			return;

		if (typeof frame === "string"){
			if(this.adaptee.timeline._labels[frame.toLowerCase()]==null){
				frame=parseInt(frame);
				if(!isNaN(frame)){
					this.adaptee.currentFrameIndex = (<number>frame)-1;
					this.adaptee.play();
				}
				return;
			}
		}
		this.adaptee.play();
		this._gotoFrame(frame);
	}

	public gotoAndStop(frame) {
		if (frame == null)
			return;
		this.adaptee.stop();
		this._gotoFrame(frame);
	}

	private _gotoFrame(frame:any):void
	{
		if(typeof frame==="number"){
			if(frame % 1!==0){
				frame=frame.toString();
			}
		} 
		if (typeof frame === "string"){
			
			if(this.adaptee.timeline._labels[frame.toLowerCase()]==null){
				frame=parseInt(frame);
				if(!isNaN(frame)){
					this.adaptee.currentFrameIndex = (<number>frame)-1;
				}
				return;
			}
			this.adaptee.jumpToLabel(<string>frame.toLowerCase());
		}
		else{
			this.adaptee.currentFrameIndex = (<number>frame) - 1;
		}
	}
	public getHitArea() {
		return this._hitArea;
	}

	public setHitArea(value) {
		// The hitArea getter always returns exactly the value set here, so we have to store that.
		this._hitArea = value;
		var obj = value ? <DisplayObject>getAwayJSAdaptee(value) : null;
		if(obj && !obj.isAsset(MovieClip))
			obj = null;

		// 	MA_GBR_0700AAx0100 is the first lesson encountered that makes use of hitArea
		// 	if the hitArea is set, the mouse-interactions on the ducks stop working
		//	this.adaptee.hitArea=obj;
	}

	public hitTest(x: number, y: number, shapeFlag: boolean): boolean {
		if (arguments.length <= 1) {
			// Alternative method signature: hitTest(target: AVM1Object): boolean
			var target = arguments[0];
			if (isNullOrUndefined(target) || !hasAwayJSAdaptee(target)) {
				return false; // target is undefined or not a AVM1 display object, returning false.
			}
			return this.adaptee.hitTestObject(<DisplayObject>getAwayJSAdaptee(target));
		}
		x = alToNumber(this.context, x);
		y = alToNumber(this.context, y);
		shapeFlag = alToBoolean(this.context, shapeFlag);
		return this.adaptee.hitTestPoint(x, y, shapeFlag);
	}

	public lineGradientStyle(fillType: string, colors: AVM1Object, alphas: AVM1Object,
							 ratios: AVM1Object, matrix: AVM1Object,
							 spreadMethod: string = 'pad', interpolationMethod: string = 'rgb',
							 focalPointRatio: number = 0.0): void {
		var context = this.context, sec = context.sec;
		fillType = alToString(this.context, fillType);
		var colorsNative = sec.createArray(
			AVM1ArrayNative.mapToJSArray(colors, (item) => alToInt32(this.context, item)));
		var alphasNative = sec.createArray(
			AVM1ArrayNative.mapToJSArray(alphas, (item) => alToNumber(this.context, item) / 100.0));
		var ratiosNative = sec.createArray(
			AVM1ArrayNative.mapToJSArray(ratios, (item) => alToNumber(this.context, item)));
		var matrixNative = null;
		if (isNullOrUndefined(matrix)) {
			somewhatImplemented('AVM1MovieClip.lineGradientStyle');
		}
		spreadMethod = alToString(this.context, spreadMethod);
		interpolationMethod = alToString(this.context, interpolationMethod);
		focalPointRatio = alToNumber(this.context, focalPointRatio);
		this.graphics.lineGradientStyle(fillType, colorsNative, alphasNative, ratiosNative, matrixNative, spreadMethod, interpolationMethod, focalPointRatio);
	}


	
	public lineStyle(thickness: number = NaN, rgb: number = 0x000000,
					 alpha: number = 100, pixelHinting: boolean = false,
					 noScale: string = 'normal', capsStyle: string = 'round',
					 jointStyle: string = 'round', miterLimit: number = 3): void {
		thickness = alToNumber(this.context, thickness);
		rgb = alToInt32(this.context, rgb);
		pixelHinting = alToBoolean(this.context, pixelHinting);
		noScale = alToString(this.context, noScale);
		var capsStyleInt = AVM1MovieClip.capStyleMapStringToInt[alToString(this.context, capsStyle)];
		var jointStyleInt = AVM1MovieClip.jointStyleMapStringToInt[alToString(this.context, jointStyle)];
		miterLimit = alToNumber(this.context, miterLimit);
		this.graphics.lineStyle(thickness, rgb, alpha / 100.0, pixelHinting, noScale, capsStyleInt, jointStyleInt, miterLimit);
	}

	public lineTo(x: number, y: number): void {
		x = toTwipFloor(alToNumber(this.context, x));
		y = toTwipFloor(alToNumber(this.context, y));
		this.graphics.lineTo(x, y);
	}

	public loadMovie(url: string, method: string) {

		var loaderHelper = new AVM1LoaderHelper(this.context);
		loaderHelper.load(url, method).then(function () {
			if(loaderHelper.content==null){
				warning("loadMovie - content is null");
				return;
			}
			this.adaptee.timeline=(<MovieClip>loaderHelper.content).timeline;
			this.adaptee["fileurl"]=loaderHelper.content["fileurl"];
			this.adaptee.reset(true);
		}.bind(this));
	}

	public loadVariables(url: string, method?: string) {
		(<any>this.context).actions._loadVariables(this, url, method);
	}

	public localToGlobal(pt) {
		var tmp = toAS3Point(pt);
		this.adaptee.localToGlobal(tmp, tmp);
		copyAS3PointTo(tmp, pt);
	}

	public get_lockroot(): boolean {
		return this._lockroot;
	}

	public set_lockroot(value: boolean) {
		somewhatImplemented('AVM1MovieClip._lockroot');
		this._lockroot = alToBoolean(this.context, value);
	}

	public moveTo(x: number, y: number): void {
		x = toTwipFloor(alToNumber(this.context, x));
		y = toTwipFloor(alToNumber(this.context, y));
		this.graphics.moveTo(x, y);
	}

	public nextFrame() {
		++this.adaptee.currentFrameIndex;
	}

	public nextScene() {
		notImplemented('AVM1MovieClip.nextScene');
	}

	public play() {
		this.adaptee.play();
	}

	public prevFrame() {
		--this.adaptee.currentFrameIndex;
	}

	public prevScene() {
		notImplemented('AVM1MovieClip.prevScene');
	}


	public setMask(mc:Object) {
		if (mc == null) {
			// Cancel a mask.
			this.adaptee.mask = null;
			return;
		}
		var mask = this.context.resolveTarget(mc);
		if (mask) {
			this.adaptee.mask = <DisplayObject>getAwayJSAdaptee(mask);
		}
	}

	public startDrag(lock?: boolean, left?: number, top?: number, right?: number, bottom?: number): void {
		lock = alToBoolean(this.context, lock);
		this._dragBounds=null;
		if (arguments.length > 1) {
			left = alToNumber(this.context, left);
			top = alToNumber(this.context, top);
			right = alToNumber(this.context, right);
			bottom = alToNumber(this.context, bottom);
			//console.log("left", left,"top", top, "right", right, "bottom", bottom );
			this._dragBounds = new this.context.sec.flash.geom.Rectangle(left, top, right - left, bottom - top);
		}//todo: listen on stage
		if(!this.isDragging){
			this.isDragging=true;
			this.startDragPoint=this.adaptee.parent.globalToLocal(new Point((<any>this.context.globals.Stage)._awayAVMStage.mouseX, (<any>this.context.globals.Stage)._awayAVMStage.mouseY));

			this.startDragMCPosition.x=this.adaptee.x;
			this.startDragMCPosition.y=this.adaptee.y;
			AVM1Stage.stage.addEventListener("mouseMove3d", this.dragListenerDelegate);
			window.addEventListener("mouseup", this.stopDragDelegate);
			window.addEventListener("touchend", this.stopDragDelegate);
			(<AVMRaycastPicker>AVM1Stage.stage.view.mousePicker).dragEntity=this.adaptee;

		}
	}

	private isDragging:boolean=false;
	private startDragPoint:Point=new Point();
	private startDragMCPosition:Point=new Point();
	private _dragBounds:any;
	public dragListenerDelegate:(e)=>void;

	public dragListener(e){
		//console.log("drag", e);
		//console.log("mouseX", (<any>this.context.globals.Stage)._awayAVMStage.mouseX);
		//console.log("mouseY", (<any>this.context.globals.Stage)._awayAVMStage.mouseY);

		var tmpPoint=this.adaptee.parent.globalToLocal(new Point((<any>this.context.globals.Stage)._awayAVMStage.mouseX, (<any>this.context.globals.Stage)._awayAVMStage.mouseY));

		this.adaptee.x=this.startDragMCPosition.x+(tmpPoint.x-this.startDragPoint.x);
		this.adaptee.y=this.startDragMCPosition.y+(tmpPoint.y-this.startDragPoint.y);

		if(this._dragBounds){
			
			if(this.adaptee.x<(this._dragBounds.left)){
				this.adaptee. x=this._dragBounds.left;
			}
			if(this.adaptee.x>(this._dragBounds.right)){
				this.adaptee.x=(this._dragBounds.right);
			}
			if(this.adaptee.y<this._dragBounds.top){
				this.adaptee.y=this._dragBounds.top;
			}
			if(this.adaptee.y>(this._dragBounds.bottom)){
				this.adaptee.y=this._dragBounds.bottom;
			}
			
		}
	}

	public stop() {
		return this.adaptee.stop();
	}
	public stopDragDelegate:(e)=>void;
	public stopDrag(e=null) {
		this.isDragging=false;

		(<AVMRaycastPicker>AVM1Stage.stage.view.mousePicker).dragEntity=null;
		AVM1Stage.stage.removeEventListener("mouseMove3d", this.dragListenerDelegate);
		window.removeEventListener("mouseup", this.stopDragDelegate);
		window.removeEventListener("touchend", this.stopDragDelegate);
	}

	public swapDepths(target: any): void {
		// if this is the scene, or if no parent exists, we do not want to do anything
		if(this.adaptee.name=="scene" || !this.get_parent()){
			return;
		}
		var parent:MovieClip = <MovieClip>getAwayJSAdaptee(this.get_parent());
		if (!parent){
			warning("AVM1MovieClip.swapDepth called for object with no parent");
			return;
		}
		if (typeof target === 'undefined') {
			warning("AVM1MovieClip.swapDepth called with undefined as target depth");
			return;
		}
		if (typeof target === 'number') {
			//console.log("swap to number", this.adaptee.name, target);
			parent.swapDepths(this.adaptee, avm2AwayDepth(target));
		}
		else if(target.adaptee){
			//console.log("swap to children", this.adaptee.name, target.adaptee.name);
			parent.swapChildren(this.adaptee, target.adaptee);
		}

	}

	public getTabChildren(): boolean {
		return getAwayObjectOrTemplate(this).tabChildren;
	}

	public setTabChildren(value: boolean) {
		getAwayObjectOrTemplate(this).tabChildren = alToBoolean(this.context, value);
	}

	public get_totalframes(): number {
		return this.adaptee.numFrames;
	}

	public getTrackAsMenu(): boolean {
		notImplemented("AVM1MovieClip.getTrackAsMenu()");
		return getAwayObjectOrTemplate(this).trackAsMenu;
	}

	public setTrackAsMenu(value: boolean) {
		notImplemented("AVM1MovieClip.setTrackAsMenu()");
		getAwayObjectOrTemplate(this).trackAsMenu = alToBoolean(this.context, value);
	}


	public unloadMovie() {
		var nativeObject = this.adaptee;
		if(nativeObject.parent){
			nativeObject.parent.removeChild(nativeObject);
		}
		nativeObject.stop();
	}

	public getUseHandCursor() {
		return this.adaptee.useHandCursor;
	}

	public setUseHandCursor(value) {
		this.adaptee.useHandCursor=value;
	}

	public setParameters(parameters: any): any {
		for (var paramName in parameters) {
			if (!this.alHasProperty(paramName)) {
				this.alPut(paramName, parameters[paramName]);
			}
		}
	}

	// Special and children names properties resolutions

	private _resolveLevelNProperty(name: string): AVM1MovieClip {
		release || assert(alIsName(this.context, name));
		if (name === '_level0') {
			return this.context.resolveLevel(0);
		} else if (name === '_root') {
			return this.context.resolveRoot();
		} else if (name.indexOf('_level') === 0) {
			var level = name.substring(6);
			var levelNum = <any>level | 0;
			if (levelNum > 0 && <any>level == levelNum) {
				return this.context.resolveLevel(levelNum)
			}
		}
		return null;
	}

	private _cachedPropertyResult;
	private _getCachedPropertyResult(value) {
		if (!this._cachedPropertyResult) {
			this._cachedPropertyResult = {
				flags: AVM1PropertyFlags.DATA | AVM1PropertyFlags.DONT_ENUM, value: value
			};
		} else {
			this._cachedPropertyResult.value = value;
		}
		return this._cachedPropertyResult;
	}

	public alGetOwnProperty(name): AVM1PropertyDescriptor {
		var desc = super.alGetOwnProperty(name);
		if (desc) {
			return desc;
		}
		if (name[0] === '_') {
			if ((name[1] === 'l' && name.indexOf('_level') === 0 ||
					name[1] === 'r' && name.indexOf('_root') === 0))
			{
				var level = this._resolveLevelNProperty(name);
				if (level) {
					return this._getCachedPropertyResult(level);
				}
			} else if (name.toLowerCase() in MovieClipProperties) {
				// For MovieClip's properties that start from '_' case does not matter.
				return super.alGetOwnProperty(name.toLowerCase());
			}
		}
		if (hasAwayJSAdaptee(this)) {
			var child = this._lookupChildByName(name);
			if (child) {
				return this._getCachedPropertyResult(child);
			}
		}
		return undefined;
	}

	public alGetOwnPropertiesKeys(): any [] {
		var keys = super.alGetOwnPropertiesKeys();
		// if it's a movie listing the children as well
		if (!hasAwayJSAdaptee(this)) {
			return keys; // not initialized yet
		}

		var as3MovieClip = this.adaptee;
		if (as3MovieClip._children.length === 0) {
			return keys; // no children
		}

		var processed = Object.create(null);
		for (var i = 0; i < keys.length; i++) {
			processed[keys[i]] = true;
		}
		for (var i = 0, length = as3MovieClip._children.length; i < length; i++) {
			var child = as3MovieClip._children[i];
			var name = child.name;
			var normalizedName = name; // TODO something like this._unescapeProperty(this._escapeProperty(name));
			processed[normalizedName] = true;
		}
		return Object.getOwnPropertyNames(processed);
	}

	private _init(initObject) {
		if (initObject instanceof AVM1Object) {
			alForEachProperty(initObject, (name: string) => {
				this.alPut(name, initObject.alGet(name));
			}, null);
		}
	}

	private _initEventsHandlers() {
		this.bindEvents([
			new AVM1EventHandler('onData', 'data'),
			new AVM1EventHandler('onDragOut', 'dragOut'),
			new AVM1EventHandler('onDragOver', 'dragOver'),
			new AVM1EventHandler('onEnterFrame', 'enterFrame'),
			new AVM1EventHandler('onKeyDown', 'keyDown'),
			new AVM1EventHandler('onKeyUp', 'keyUp'),
			new AVM1EventHandler('onKillFocus', 'focusOut', function (e) {
				return [e.relatedObject];
			}),
			new AVM1EventHandler('onLoad', 'load'),
			new AVM1EventHandler('onMouseDown', 'mouseDown3d', null, true),
			new AVM1EventHandler('onMouseUp', 'mouseUp3d', null, true),
			new AVM1EventHandler('onMouseMove', 'mouseMove3d', null, true),
			new AVM1MovieClipButtonModeEvent('onPress', 'mouseDown3d'),
			new AVM1MovieClipButtonModeEvent('onRelease', 'mouseUp3d'),
			new AVM1MovieClipButtonModeEvent('onReleaseOutside', 'mouseUpOutside3d'),
			new AVM1MovieClipButtonModeEvent('onRollOut', 'mouseOut3d'),
			new AVM1MovieClipButtonModeEvent('onRollOver', 'mouseOver3d'),
			new AVM1EventHandler('onSetFocus', 'focusIn', function (e) {
				return [e.relatedObject];
			}),
			new AVM1EventHandler( 'onUnload', 'unload')
		]);
	}
}

