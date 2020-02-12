import {IAssetAdapter, Point} from "@awayjs/core";
import {BitmapImage2D, Image2D} from "@awayjs/stage";
import {Timeline, MovieClip as AwayMovieClip, Sprite as AwaySprite, DisplayObjectContainer as AwayDisplayObjectContainer, Billboard, ISceneGraphFactory, TextField as AwayTextField, PrefabBase} from "@awayjs/scene";
import {MethodMaterial, MaterialBase} from "@awayjs/materials";
import {DefaultSceneGraphFactory} from "@awayjs/scene";
import {SceneImage2D} from "@awayjs/scene";

import {Sprite} from "../display/Sprite";
import {MovieClip} from "../display/MovieClip";
import {Bitmap} from "../display/Bitmap";
import {BitmapData} from "../display/BitmapData";
import {DisplayObjectContainer} from "../display/DisplayObjectContainer";
import {TextField} from "../text/TextField";
import { Graphics } from '@awayjs/graphics';
import { Graphics as Graphicsadapter} from '../display/graphics';
import { AXSecurityDomain } from '../../avm2/run/AXSecurityDomain';
import { Multiname } from '../../avm2/abc/lazy/Multiname';
import { NamespaceType } from '../../avm2/abc/lazy/NamespaceType';
import { constructClassFromSymbol } from '../../avm2/constructClassFromSymbol';
import { ABCFile } from '../../avm2/abc/lazy/ABCFile';
import { ISecurityDomain } from '../../avm1/ISecurityDomain';
import { AXClass } from '../../avm2/run/AXClass';

export class FlashSceneGraphFactory extends DefaultSceneGraphFactory implements ISceneGraphFactory
{
	public imageStore:Object = {};
	public url:string = "";
	private _sec:ISecurityDomain;

	constructor(sec:ISecurityDomain){
		super();
		this._sec=sec;
	}
	public executeABCBytes(abcBlocks:any[])
	{
		for (var i = 0; i < abcBlocks.length; i++) {
			var abcBlock = abcBlocks[i];
			var abc = new ABCFile({ app: this._sec.application, url: "" }, abcBlock.data);
			if (abcBlock.flags) {
				// kDoAbcLazyInitializeFlag = 1 Indicates that the ABC block should not be executed
				// immediately.
				this._sec.application.loadABC(abc);
			} else {
				// TODO: probably delay execution until playhead reaches the frame.
				this._sec.application.loadAndExecuteABC(abc);
			}
		}
		return null;
	}
	public createSprite(prefab:PrefabBase = null, graphics:Graphics = null, symbol:any=null):AwaySprite
	{
		if(!symbol || !this._sec)
			throw("no symbol provided");

		var symbolClass = null; 
		if(symbol.className)
			symbolClass = this._sec.application.getClass(Multiname.FromFQNString(symbol.className, NamespaceType.Public));
		else
			symbolClass=this._sec.flash.display.Sprite.axClass;

		symbol.symbolClass=symbolClass;
		//Graphicsadapter.currentAwayGraphics=graphics;
		// create the root for the root-symbol
		var asObj = constructClassFromSymbol(symbol, symbolClass);
		asObj.adaptee= new AwaySprite(graphics);
		// manually call the axInitializer for now:
		//asObj.axInitializer(AwaySprite.getNewSprite(new this._sec.flash.display.Graphics(graphics).adaptee));

		asObj.adaptee["fileurl"]=this.url;
		return asObj.adaptee;
	}

	public createDisplayObjectContainer(symbol:any=null):AwayDisplayObjectContainer
	{
		return <AwayDisplayObjectContainer> new this._sec.flash.display.DisplayObjectContainer().adaptee;
	}

	public createBinarySymbol(symbol:any=null):void
	{
		this._sec.application.addBinarySymbol(symbol);
	}
	public createMovieClip(timeline:Timeline = null, symbol:any=null):AwayMovieClip
	{
		if(!symbol || !this._sec)
			throw("no symbol provided");

		var symbolClass:AXClass = null;
		if(symbol.className){
			symbolClass = this._sec.application.getClass(Multiname.FromFQNString(symbol.className, NamespaceType.Public));
			(<any>symbolClass)._symbol=symbol;
		}
		else
			symbolClass = this._sec.flash.display.MovieClip.axClass;
		//console.log("parsed symbolClass", symbolClass, symbol);
		symbol.symbolClass=symbolClass;
		
		// create the root for the root-symbol
		var asObj = constructClassFromSymbol(symbol, this._sec.flash.display.MovieClip.axClass);

		asObj.adaptee= new AwayMovieClip();
		symbol.timeline=asObj.adaptee.timeline;

		//(<AwayMovieClip>asObj.adaptee).timeline.resetScripts();
		//(<any>asObj).axInitializer();
		asObj.adaptee.timelineMC=true;
		asObj.adaptee["fileurl"]=this.url;
		return asObj.adaptee;
	}

	public createTextField(symbol:any=null):AwayTextField
	{
		var symbolClass:AXClass = null;
		if(symbol.className)
			symbolClass = this._sec.application.getClass(Multiname.FromFQNString(symbol.className, NamespaceType.Public));
		else
			symbolClass = this._sec.flash.text.TextField.axClass;
		symbol.symbolClass=symbolClass;
		// create the root for the root-symbol
		var asObj = constructClassFromSymbol(symbol, symbolClass);
		// 	manually call the axInitializer - this will run the constructor
		//	creating new Away-MovieClip and timeline, and registers framescripts on the timeline:
		asObj.axInitializer();
		asObj.adaptee["fileurl"]=this.url;
		return asObj.adaptee;
	}

	public createBillboard(material:MaterialBase, symbol:any=null):Billboard
	{
		return <Billboard> new Bitmap(<BitmapData> material.style.image.adapter).adaptee;
	}

	public createImage2D(width:number, height:number, transparent:boolean = true, fillColor:number = null, powerOfTwo:boolean = true, symbol:any=null):Image2D
	{
		return <SceneImage2D> new BitmapData(width, height, transparent, fillColor).adaptee;
	}
}